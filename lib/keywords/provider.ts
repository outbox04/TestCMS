import fs from "node:fs";
import path from "node:path";
import { CHECK_CONFIG } from "@/lib/checks/config";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export interface KeywordSuggestionItem {
  keyword: string;
  source: "mock" | "autocomplete" | "paa" | "related";
  volume: "unknown";
  intentCluster?: string;
  targetStatus?: "proposed" | "existing";
}

export interface KeywordLookupOptions {
  lang?: string;
  country?: string;
  domain?: string;
  paaDepthLimit?: number;
}

export interface KeywordProvider {
  getSuggestions(
    topic: string,
    options?: KeywordLookupOptions
  ): Promise<KeywordSuggestionItem[]>;
}

/**
 * Loại trùng từ khóa (không phân biệt hoa/thường và khoảng trắng thừa)
 * và giới hạn tối đa MAX_KEYWORD_SUGGESTIONS (mặc định 30) — R-01, R-04, R-05, R-06, R-07.
 */
export function deduplicateAndCapKeywords(
  rawKeywords: string[],
  maxCount: number = CHECK_CONFIG.MAX_KEYWORD_SUGGESTIONS
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of rawKeywords) {
    const cleaned = item.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const normalized = cleaned.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(cleaned);
    if (result.length >= maxCount) break;
  }

  return result;
}

/**
 * Gom cụm từ khóa cấp trang theo ý định tìm kiếm (SERP intent) và gắn nhãn proposed (R-05, R-06, R-07).
 * Với tập < 10 từ khóa thì gom thành 1 cụm đơn giản (R-06).
 */
export function clusterKeywordsByIntent(
  keywords: string[]
): KeywordSuggestionItem[] {
  const deduped = deduplicateAndCapKeywords(keywords);
  const isSmallSet = deduped.length < 10;

  return deduped.map((kw) => {
    const lower = kw.toLowerCase();
    let cluster = "general-topic";
    if (!isSmallSet) {
      if (
        lower.includes("cách") ||
        lower.includes("hướng dẫn") ||
        lower.includes("nhiệt độ")
      ) {
        cluster = "informational-guide";
      } else if (
        lower.includes("giá") ||
        lower.includes("mua") ||
        lower.includes("so sánh")
      ) {
        cluster = "commercial-evaluation";
      } else {
        cluster = "product-core";
      }
    }
    return {
      keyword: kw,
      source: "mock",
      volume: "unknown", // Không bịa đặt số liệu tìm kiếm (R-04)
      intentCluster: cluster,
      targetStatus: "proposed", // Gắn nhãn proposed khi chưa có URL thực tế (R-06)
    };
  });
}

class MockKeywordProvider implements KeywordProvider {
  async getSuggestions(topic: string): Promise<KeywordSuggestionItem[]> {
    const fixturePath = path.join(
      process.cwd(),
      "fixtures",
      "keywords.demo.json"
    );
    const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
      default_suggestions?: string[];
      by_topic?: Record<string, string[]>;
    };

    const combined: string[] = [topic.trim()];
    const topicLower = topic.toLowerCase();

    for (const [key, list] of Object.entries(raw.by_topic ?? {})) {
      if (topicLower.includes(key.toLowerCase())) {
        combined.push(...list);
      }
    }

    combined.push(...(raw.default_suggestions ?? []));
    return clusterKeywordsByIntent(combined);
  }
}

let lastAutocompleteCallAt = 0;
const MIN_AUTOCOMPLETE_INTERVAL_MS = 1000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày theo R-03

class AutocompleteKeywordProvider implements KeywordProvider {
  async getSuggestions(
    topic: string,
    options?: KeywordLookupOptions
  ): Promise<KeywordSuggestionItem[]> {
    const lang = options?.lang ?? "vi";
    const country = options?.country ?? "vn";
    const normalizedSeed = topic.trim().toLowerCase();

    // Kiểm tra cache 30 ngày trong bảng keyword_cache (R-03)
    try {
      const admin = createAdminSupabaseClient();
      const { data: cached } = await admin
        .from("keyword_cache")
        .select("results, fetched_at")
        .eq("keyword", normalizedSeed)
        .eq("source", "autocomplete")
        .eq("lang", lang)
        .eq("country", country)
        .maybeSingle();

      if (cached?.results && cached.fetched_at) {
        const age = Date.now() - new Date(cached.fetched_at).getTime();
        if (age < CACHE_TTL_MS && Array.isArray(cached.results)) {
          const cachedStrings = cached.results.map((x) => String(x));
          return clusterKeywordsByIntent(cachedStrings).map((item) => ({
            ...item,
            source: "autocomplete",
          }));
        }
      }
    } catch {
      // Tiếp tục gọi endpoint nếu chưa đọc được cache
    }

    // Giới hạn tốc độ (rate limiting)
    const now = Date.now();
    const elapsed = now - lastAutocompleteCallAt;
    if (elapsed < MIN_AUTOCOMPLETE_INTERVAL_MS) {
      await new Promise((r) =>
        setTimeout(r, MIN_AUTOCOMPLETE_INTERVAL_MS - elapsed)
      );
    }
    lastAutocompleteCallAt = Date.now();

    const url = new URL("https://suggestqueries.google.com/complete/search");
    url.searchParams.set("client", "firefox");
    url.searchParams.set("hl", lang);
    url.searchParams.set("gl", country);
    url.searchParams.set("q", topic.trim());

    let suggestions: string[] = [topic.trim()];
    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const payload = (await response.json()) as unknown;
        if (Array.isArray(payload) && Array.isArray(payload[1])) {
          const fetched = payload[1].map((item) => String(item));
          suggestions = deduplicateAndCapKeywords([topic.trim(), ...fetched]);
        }
      }
    } catch {
      // Fallback an toàn về từ khóa gốc nếu mạng lỗi
    }

    try {
      const admin = createAdminSupabaseClient();
      await admin.from("keyword_cache").upsert({
        keyword: normalizedSeed,
        source: "autocomplete",
        lang,
        country,
        results: suggestions,
        fetched_at: new Date().toISOString(),
      });
    } catch {
      // Bỏ qua lỗi ghi cache nếu có
    }

    return clusterKeywordsByIntent(suggestions).map((item) => ({
      ...item,
      source: "autocomplete",
    }));
  }
}

export function createKeywordProvider(): KeywordProvider {
  const mode = (process.env.KEYWORD_PROVIDER ?? "mock").trim().toLowerCase();
  if (mode === "autocomplete") {
    return new AutocompleteKeywordProvider();
  }
  return new MockKeywordProvider();
}

