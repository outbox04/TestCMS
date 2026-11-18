import "server-only";
import { revalidatePath } from "next/cache";
import { CHECK_CONFIG } from "@/lib/checks/config";
import { runAllArticleChecks } from "@/lib/checks";
import { sanitizeAndValidateImageAnalysis } from "@/lib/images/processor";
import { createKeywordProvider, deduplicateAndCapKeywords } from "@/lib/keywords/provider";
import { loadRules } from "@/lib/knowledge/rules";
import { createLlmProvider } from "@/lib/llm";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  ArticleOutlinePayloadSchema,
  ImageAnalysisSchema,
  type ArticleAssetRow,
  type ArticleEventRow,
  type ArticleOutlinePayload,
  type ArticleRow,
  type ArticleStatus,
  type BrandProfileRow,
  type OutlineItem,
} from "@/lib/supabase/types";
import {
  PlanOutlineEngineOutputSchema,
  WRITING_ENGINE_PROMPT_VERSION,
  WriteArticleEngineOutputSchema,
  analyzeSearchIntentAndTopic,
  buildPlanOutlineSystemPrefix,
  buildPlanOutlineUserPrompt,
  buildWriteArticleSystemPrefix,
  buildWriteArticleUserPrompt,
  getRevalidatePathsForArticle,
  verifyArticleClaimsAndEnforceTruthLabels,
  verifyOutlineFacts,
} from "@/lib/writing-engine";

export interface PoppedJobRow {
  msg_id: number;
  message: {
    step: "plan_outline" | "analyze_images" | "write_article" | "revalidate";
    article_id: string;
    version: number;
  };
  read_ct: number;
}

export interface WorkerExecutionResult {
  processed: boolean;
  msgId?: number;
  step?: string;
  articleId?: string;
  status?: string;
  detail: string;
}

const EXPECTED_STATUS_BY_STEP: Record<
  PoppedJobRow["message"]["step"],
  ArticleStatus
> = {
  plan_outline: "outline_draft",
  analyze_images: "analyzing_images",
  write_article: "writing",
  revalidate: "published",
};

export function slugifyVietnamese(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extractOutlineItems(
  outlineField: ArticleRow["outline"]
): { items: OutlineItem[]; needsInfo: string[] } {
  if (!outlineField) {
    return { items: [], needsInfo: [] };
  }
  if (Array.isArray(outlineField)) {
    return { items: outlineField, needsInfo: [] };
  }
  const parsed = ArticleOutlinePayloadSchema.safeParse(outlineField);
  if (parsed.success) {
    return {
      items: parsed.data.items,
      needsInfo: parsed.data.needs_info,
    };
  }
  return { items: [], needsInfo: [] };
}

async function fetchLatestEditorNote(
  articleId: string,
  targetStatus: ArticleStatus
): Promise<string | null> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("article_events")
      .select("actor_kind, to_status, note, created_at")
      .eq("article_id", articleId)
      .order("created_at", { ascending: false })
      .limit(10);

    const events = (data ?? []) as Pick<
      ArticleEventRow,
      "actor_kind" | "to_status" | "note" | "created_at"
    >[];
    const matched = events.find(
      (ev) =>
        ev.actor_kind === "editor" &&
        ev.to_status === targetStatus &&
        Boolean(ev.note?.trim())
    );
    return matched?.note?.trim() ?? null;
  } catch {
    return null;
  }
}

async function handlePlanOutline(
  article: ArticleRow,
  brand: BrandProfileRow
): Promise<string> {
  const admin = createAdminSupabaseClient();
  const llm = createLlmProvider();
  const kwProvider = createKeywordProvider();

  const rawSuggestions = await kwProvider.getSuggestions(article.topic);
  const preAnalysis = analyzeSearchIntentAndTopic(
    article.topic,
    rawSuggestions
  );
  const dedupedKeywords = deduplicateAndCapKeywords(
    rawSuggestions.map((s) => s.keyword),
    CHECK_CONFIG.MAX_KEYWORD_SUGGESTIONS
  );

  const editorNote = await fetchLatestEditorNote(article.id, "outline_draft");
  const systemPrefix = buildPlanOutlineSystemPrefix(brand);
  const prompt = buildPlanOutlineUserPrompt({
    topic: article.topic,
    dedupedKeywords,
    inferredIntent: preAnalysis.inferredIntent,
    inferredContentType: preAnalysis.inferredContentType,
    editorNote,
  });

  const res = await llm.generateStructured({
    step: "plan_outline",
    articleId: article.id,
    schema: PlanOutlineEngineOutputSchema,
    systemCacheablePrefix: systemPrefix,
    prompt,
  });

  const verifiedOutline = verifyOutlineFacts(res.data, brand);

  const outlinePayload: ArticleOutlinePayload = {
    search_intent:
      verifiedOutline.search_intent ?? preAnalysis.inferredIntent,
    content_type:
      verifiedOutline.content_type ?? preAnalysis.inferredContentType,
    items: verifiedOutline.items,
    needs_info: verifiedOutline.needs_info,
    prompt_version: WRITING_ENGINE_PROMPT_VERSION,
  };

  const { error: updErr } = await admin
    .from("articles")
    .update({
      primary_keyword: res.data.primary_keyword,
      secondary_keywords: res.data.secondary_keywords.slice(
        0,
        CHECK_CONFIG.MAX_SECONDARY_KEYWORDS
      ),
      faq_questions: res.data.faq_questions.slice(
        0,
        CHECK_CONFIG.MAX_FAQ_COUNT
      ),
      outline: outlinePayload,
      last_error: null,
    })
    .eq("id", article.id);

  if (updErr) {
    throw new Error(`Lỗi lưu dàn ý: ${updErr.message}`);
  }

  // Chuyển trạng thái qua hàm SQL transition_article với vai trò agent (R-37)
  const { error: transErr } = await admin.rpc("transition_article", {
    p_article_id: article.id,
    p_to: "outline_review",
    p_expected_version: article.version,
    p_actor_kind: "agent",
    p_note: "Agent hoàn tất lập dàn ý & từ khóa",
  });

  if (transErr) {
    throw new Error(`Lỗi chuyển sang outline_review: ${transErr.message}`);
  }

  return "Đã lập dàn ý và chuyển sang Cổng 1 (outline_review)";
}

async function handleAnalyzeImages(
  article: ArticleRow,
  brand: BrandProfileRow
): Promise<string> {
  const admin = createAdminSupabaseClient();
  const llm = createLlmProvider();
  const imageRules = loadRules("image");

  const { data: assetsData, error: assetsErr } = await admin
    .from("article_assets")
    .select("*")
    .eq("article_id", article.id)
    .order("created_at", { ascending: true });

  if (assetsErr) {
    throw new Error(`Lỗi đọc danh sách ảnh: ${assetsErr.message}`);
  }

  const assets = (assetsData ?? []) as ArticleAssetRow[];
  if (assets.length === 0) {
    throw new Error("Bài viết chưa có ảnh nào để phân tích");
  }

  let analyzedCount = 0;
  let reusedCacheCount = 0;

  for (const asset of assets) {
    if (asset.analyzed_at && asset.analysis) {
      continue;
    }

    // Kiểm tra cache theo sha256 ở các bản ghi đã phân tích trước đó (R-13)
    const { data: cachedAsset } = await admin
      .from("article_assets")
      .select("analysis, alt_text, analyzed_at")
      .eq("sha256", asset.sha256)
      .not("analyzed_at", "is", null)
      .limit(1)
      .maybeSingle();

    if (cachedAsset?.analysis && cachedAsset.analyzed_at) {
      const sanitizedCached = sanitizeAndValidateImageAnalysis(
        ImageAnalysisSchema.parse(cachedAsset.analysis),
        brand
      );
      const { error: cacheUpdErr } = await admin
        .from("article_assets")
        .update({
          analysis: sanitizedCached,
          alt_text: asset.alt_text || sanitizedCached.alt_text,
          analyzed_at: new Date().toISOString(),
        })
        .eq("id", asset.id);

      if (cacheUpdErr) {
        throw new Error(`Lỗi cập nhật cache ảnh: ${cacheUpdErr.message}`);
      }
      reusedCacheCount++;
      continue;
    }

    const pathToRead = asset.analysis_path || asset.storage_path;
    const { data: fileBlob, error: dlErr } = await admin.storage
      .from("article-images")
      .download(pathToRead);

    if (dlErr || !fileBlob) {
      throw new Error(
        `Không tải được ảnh phân tích (${pathToRead}): ${dlErr?.message ?? "no blob"}`
      );
    }

    const imageBytes = new Uint8Array(await fileBlob.arrayBuffer());
    const prompt = [
      "Phân tích hình ảnh phục vụ bài viết theo quy tắc sau:",
      imageRules,
      "",
      "Yêu cầu:",
      "- description: mô tả ngắn gọn nội dung thị giác trong ảnh (<= 40 từ).",
      "- alt_text: văn bản thay thế mô tả chính xác ảnh (<= 125 ký tự, không rỗng).",
      "- subjects: danh sách đối tượng chính nhìn thấy trong ảnh.",
      "- visible_text: văn bản thực sự đọc được trên ảnh (hoặc null nếu không có).",
      "- TUYỆT ĐỐI CẤM tự gán tên thương hiệu hoặc tên sản phẩm nếu không nhìn thấy chữ đó trên ảnh.",
    ].join("\n");

    const aiRes = await llm.analyzeImage({
      step: "analyze_images",
      articleId: article.id,
      schema: ImageAnalysisSchema,
      imageBytes,
      mimeType: "image/jpeg",
      prompt,
    });

    const sanitized = sanitizeAndValidateImageAnalysis(aiRes.data, brand);

    const { error: saveErr } = await admin
      .from("article_assets")
      .update({
        analysis: sanitized,
        alt_text: asset.alt_text || sanitized.alt_text,
        analyzed_at: new Date().toISOString(),
      })
      .eq("id", asset.id);

    if (saveErr) {
      throw new Error(`Lỗi lưu kết quả phân tích ảnh: ${saveErr.message}`);
    }

    analyzedCount++;
  }

  const { error: transErr } = await admin.rpc("transition_article", {
    p_article_id: article.id,
    p_to: "writing",
    p_expected_version: article.version,
    p_actor_kind: "agent",
    p_note: `Đã phân tích ${analyzedCount} ảnh mới, tái sử dụng cache ${reusedCacheCount} ảnh`,
  });

  if (transErr) {
    throw new Error(`Lỗi chuyển sang writing: ${transErr.message}`);
  }

  return `Đã hoàn tất phân tích ảnh (${analyzedCount} gọi AI, ${reusedCacheCount} dùng cache sha256) và chuyển sang writing`;
}

async function handleWriteArticle(
  article: ArticleRow,
  brand: BrandProfileRow
): Promise<string> {
  const admin = createAdminSupabaseClient();
  const llm = createLlmProvider();

  const { data: assetsData } = await admin
    .from("article_assets")
    .select("*")
    .eq("article_id", article.id)
    .order("created_at", { ascending: true });

  const assets = (assetsData ?? []) as ArticleAssetRow[];
  const { items: outlineItems, needsInfo: outlineNeedsInfo } =
    extractOutlineItems(article.outline);

  const editorNote = await fetchLatestEditorNote(article.id, "writing");

  // Phần cố định đặt ở đầu prompt để tận dụng Prompt Caching (R-16): [loadRules(["write", "schema"]) + brand_profile]
  const systemCacheablePrefix = buildWriteArticleSystemPrefix(brand);

  const slugCandidate =
    article.slug ||
    `${slugifyVietnamese(article.primary_keyword || article.topic)}-${article.id.slice(0, 6)}`;

  let retryErrors: string[] = [];

  for (
    let attempt = 0;
    attempt <= CHECK_CONFIG.WRITER_CHECK_MAX_RETRIES;
    attempt++
  ) {
    const variablePrompt = buildWriteArticleUserPrompt({
      topic: article.topic,
      primaryKeyword: article.primary_keyword ?? article.topic,
      secondaryKeywords: article.secondary_keywords ?? [],
      faqQuestions: article.faq_questions ?? [],
      outlineItems,
      outlineNeedsInfo,
      assets: assets.map((a) => ({
        asset_id: a.id,
        alt_text: a.alt_text,
        analysis: a.analysis,
      })),
      editorNote,
      retryErrors,
    });

    const aiRes = await llm.generateStructured({
      step: attempt === 0 ? "write_article" : "write_article_retry",
      articleId: article.id,
      schema: WriteArticleEngineOutputSchema,
      systemCacheablePrefix,
      prompt: variablePrompt,
    });

    // Năng lực 5: Kiểm chứng dữ kiện & Cưỡng bức 5 nhãn sự thật (Truth Guard)
    const verifiedClaims = verifyArticleClaimsAndEnforceTruthLabels({
      contentBlocks: aiRes.data.content_blocks,
      rawNeedsInfo: aiRes.data.needs_info,
      seoNeedsInfo: aiRes.data.seo.needs_info,
      outlineNeedsInfo,
      brand,
    });

    const checkReport = runAllArticleChecks({
      topic: article.topic,
      primaryKeyword: article.primary_keyword ?? article.topic,
      secondaryKeywords: article.secondary_keywords ?? [],
      slug: slugCandidate,
      seo: aiRes.data.seo,
      contentBlocks: verifiedClaims.content_blocks,
      needsInfo: verifiedClaims.needs_info,
      brandProfile: brand,
      assets: assets.map((a) => ({ id: a.id, alt_text: a.alt_text })),
    });

    if (checkReport.passed) {
      const { error: saveErr } = await admin
        .from("articles")
        .update({
          slug: slugCandidate,
          outline: {
            items: outlineItems,
            needs_info: [],
            prompt_version: WRITING_ENGINE_PROMPT_VERSION,
          },
          seo: {
            ...aiRes.data.seo,
            prompt_version: WRITING_ENGINE_PROMPT_VERSION,
            needs_info: [],
          },
          content_blocks: verifiedClaims.content_blocks,
          checks_passed: true,
          check_report: checkReport,
          last_error: null,
        })
        .eq("id", article.id);

      if (saveErr) {
        throw new Error(`Lỗi lưu bài nháp: ${saveErr.message}`);
      }

      // Chuyển writing -> draft_ready -> preview_review qua transition_article (R-37)
      const { data: afterDraftReady, error: trans1Err } = await admin.rpc(
        "transition_article",
        {
          p_article_id: article.id,
          p_to: "draft_ready",
          p_expected_version: article.version,
          p_actor_kind: "agent",
          p_note: "Agent hoàn tất viết bài nháp",
        }
      );

      if (trans1Err || !afterDraftReady) {
        throw new Error(
          `Lỗi chuyển sang draft_ready: ${trans1Err?.message ?? "unknown"}`
        );
      }

      const nextVer = (afterDraftReady as ArticleRow).version;
      const { error: trans2Err } = await admin.rpc("transition_article", {
        p_article_id: article.id,
        p_to: "preview_review",
        p_expected_version: nextVer,
        p_actor_kind: "agent",
        p_note: "Kiểm tra tự động đạt 6/6, chuyển sang Cổng 2 (preview_review)",
      });

      if (trans2Err) {
        throw new Error(
          `Lỗi chuyển sang preview_review: ${trans2Err.message}`
        );
      }

      return "Đã viết bài, vượt qua 6/6 kiểm tra tự động và chuyển sang Cổng 2 (preview_review)";
    }

    retryErrors = checkReport.items
      .filter((i) => !i.passed)
      .map((i) => `- [${i.code}] ${i.message}`);

    // Lưu lại báo cáo kiểm tra của lần thử hiện tại
    await admin
      .from("articles")
      .update({
        slug: slugCandidate,
        seo: {
          ...aiRes.data.seo,
          prompt_version: WRITING_ENGINE_PROMPT_VERSION,
          needs_info: verifiedClaims.needs_info,
        },
        content_blocks: verifiedClaims.content_blocks,
        checks_passed: false,
        check_report: checkReport,
        last_error: `Kiểm tra tự động chưa đạt: ${retryErrors.join(" | ")}`,
      })
      .eq("id", article.id);

    // Nếu trượt do thiếu thông tin thực tế trong brand_profile (needs_info khác rỗng), không cần gọi lại AI để tránh bịa
    if (verifiedClaims.needs_info.length > 0) {
      break;
    }
  }

  return `Bài viết chưa vượt qua kiểm tra tự động và được giữ nguyên ở trạng thái writing: ${retryErrors.join(" | ")}`;
}

/**
 * Xử lý tối đa 1 job từ hàng đợi pgmq `agent_jobs` (Giai đoạn 5).
 */
export async function processNextAgentJob(): Promise<WorkerExecutionResult> {
  const admin = createAdminSupabaseClient();

  const { data: jobRows, error: popErr } = await admin.rpc("agent_pop_job");
  if (popErr) {
    throw new Error(`Không đọc được hàng đợi agent_jobs: ${popErr.message}`);
  }

  const jobs = (jobRows ?? []) as PoppedJobRow[];
  if (jobs.length === 0) {
    return {
      processed: false,
      detail: "Hàng đợi agent_jobs hiện đang trống.",
    };
  }

  const job = jobs[0];
  const { msg_id: msgId, message, read_ct: readCt } = job;
  const { step, article_id: articleId, version: expectedVersion } = message;

  const { data: articleData, error: artErr } = await admin
    .from("articles")
    .select("*")
    .eq("id", articleId)
    .maybeSingle();

  if (artErr || !articleData) {
    await admin.rpc("agent_ack_job", { p_msg_id: msgId });
    return {
      processed: true,
      msgId,
      step,
      articleId,
      detail: "Bài viết không còn tồn tại; đã ack và bỏ qua job.",
    };
  }

  const article = articleData as ArticleRow;
  const expectedStatus = EXPECTED_STATUS_BY_STEP[step];

  // Kiểm tra version và status còn khớp với tin nhắn, lệch thì ack và bỏ qua (Giai đoạn 5)
  if (
    article.version !== expectedVersion ||
    article.status !== expectedStatus
  ) {
    await admin.rpc("agent_ack_job", { p_msg_id: msgId });
    return {
      processed: true,
      msgId,
      step,
      articleId,
      status: article.status,
      detail: `Job lệch version/status (job v${expectedVersion}/${expectedStatus} vs bài v${article.version}/${article.status}); đã ack và bỏ qua.`,
    };
  }

  try {
    if (step === "revalidate") {
      const pathsToRevalidate = getRevalidatePathsForArticle(article.slug);
      for (const p of pathsToRevalidate) {
        revalidatePath(p);
      }
      await admin.rpc("agent_ack_job", { p_msg_id: msgId });
      return {
        processed: true,
        msgId,
        step,
        articleId,
        status: article.status,
        detail: `Đã revalidate (${pathsToRevalidate.join(", ")}).`,
      };
    }

    const { data: brandData, error: brandErr } = await admin
      .from("brand_profile")
      .select("*")
      .eq("id", true)
      .single();

    if (brandErr || !brandData) {
      throw new Error("Không đọc được brand_profile");
    }

    const brand = brandData as BrandProfileRow;
    let detail = "";

    if (step === "plan_outline") {
      detail = await handlePlanOutline(article, brand);
    } else if (step === "analyze_images") {
      detail = await handleAnalyzeImages(article, brand);
    } else if (step === "write_article") {
      detail = await handleWriteArticle(article, brand);
    } else {
      throw new Error(`Bước worker không xác định: ${String(step)}`);
    }

    await admin.rpc("agent_ack_job", { p_msg_id: msgId });

    return {
      processed: true,
      msgId,
      step,
      articleId,
      detail,
    };
  } catch (err) {
    const errMsg =
      err instanceof Error ? err.message : "Lỗi không xác định khi chạy worker";

    // Nếu read_ct > 3 thì ack và ghi last_error; ngược lại không ack để thử lại sau visibility timeout (R-34)
    if (readCt > CHECK_CONFIG.WORKER_MAX_RETRIES) {
      await admin
        .from("articles")
        .update({
          last_error: `Job ${step} thất bại sau ${readCt} lần thử: ${errMsg}`,
        })
        .eq("id", article.id);
      await admin.rpc("agent_ack_job", { p_msg_id: msgId });

      return {
        processed: true,
        msgId,
        step,
        articleId,
        detail: `Job thất bại quá ${CHECK_CONFIG.WORKER_MAX_RETRIES} lần (read_ct=${readCt}), đã ack và ghi last_error: ${errMsg}`,
      };
    }

    await admin
      .from("articles")
      .update({
        last_error: `Lỗi tạm thời ở lần đọc #${readCt}: ${errMsg}`,
      })
      .eq("id", article.id);

    throw new Error(
      `Job #${msgId} (${step}) lỗi ở lần thử #${readCt} (chưa ack để thử lại sau VT): ${errMsg}`
    );
  }
}

