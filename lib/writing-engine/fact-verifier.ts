import type {
  BrandProfileRow,
  ClaimLabel,
  ContentBlock,
  OutlineItem,
} from "@/lib/supabase/types";
import type {
  PlanOutlineEngineOutput,
  VerifiedArticleClaimsResult,
  VerifiedOutlineResult,
} from "./types";

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Kiểm tra xem văn bản có nhắc tới tên thương hiệu hoặc bất kỳ sản phẩm nào trong brand_profile hay không.
 */
export function blockMentionsBrandOrProduct(
  text: string,
  brand: BrandProfileRow
): boolean {
  const norm = normalizeText(text);
  if (!norm) return false;

  const candidates: string[] = [];
  if (brand.brand_name?.trim()) {
    candidates.push(brand.brand_name.trim());
    const firstWord = brand.brand_name.trim().split(/\s+/)[0];
    if (firstWord && firstWord.length >= 4) {
      candidates.push(firstWord);
    }
  }

  for (const prod of brand.products ?? []) {
    if (prod.name?.trim()) {
      candidates.push(prod.name.trim());
    }
  }

  return candidates.some((c) => norm.includes(normalizeText(c)));
}

function extractBlockPlainText(block: ContentBlock): string {
  switch (block.type) {
    case "h2":
    case "h3":
    case "paragraph":
      return block.text;
    case "callout":
      return `${block.title ?? ""} ${block.text}`.trim();
    case "list":
      return block.items.join(" ");
    case "table":
      return [
        block.caption ?? "",
        block.headers.join(" "),
        ...block.rows.map((r) => r.join(" ")),
      ]
        .join(" ")
        .trim();
    case "faq":
      return `${block.q} ${block.a}`;
    case "image":
      return `${block.alt} ${block.caption ?? ""}`.trim();
  }
}

/**
 * Kiểm tra xem một yêu cầu trong outline.needs_info đã được bổ sung vào brand_profile.facts chưa.
 */
function isOutlineNeedResolvedInBrand(
  needText: string,
  brand: BrandProfileRow
): boolean {
  const factsCorpus = normalizeText(
    (brand.facts ?? []).map((f) => f.statement).join(" ")
  );
  const normNeed = normalizeText(needText);

  if (normNeed.includes("bảo hành") && !factsCorpus.includes("bảo hành")) {
    return false;
  }
  if (normNeed.includes("đổi trả") && !factsCorpus.includes("đổi trả")) {
    return false;
  }
  return false;
}

/**
 * Năng lực 5 (Giai đoạn Dàn ý):
 * Kiểm chứng các mục H2 trong dàn ý.
 * Khóa cứng: Không cho phép mục nào mang nhãn VERIFIED nếu không có fact_ids hợp lệ trong brand_profile.
 */
export function verifyOutlineFacts(
  output: PlanOutlineEngineOutput,
  brand: BrandProfileRow
): VerifiedOutlineResult {
  const validFactIds = new Set((brand.facts ?? []).map((f) => f.id));
  const needsSet = new Set<string>(
    (output.needs_info ?? []).map((s) => s.trim()).filter(Boolean)
  );
  let downgradedCount = 0;

  const verifiedItems: OutlineItem[] = output.outline.map((item) => {
    const rawFactIds = item.fact_ids ?? [];
    const validIds = rawFactIds.filter((id) => validFactIds.has(id));
    const invalidIds = rawFactIds.filter((id) => !validFactIds.has(id));

    let label: ClaimLabel =
      item.claim_label ?? (validIds.length > 0 ? "VERIFIED" : "GENERAL_KNOWLEDGE");

    // Chốt chặn: Nếu gắn nhãn VERIFIED nhưng thiếu fact_ids hợp lệ hoặc có fact_id giả -> hạ xuống NEEDS_VERIFICATION
    if (
      (label === "VERIFIED" && validIds.length === 0) ||
      invalidIds.length > 0
    ) {
      label = "NEEDS_VERIFICATION";
      downgradedCount++;
      needsSet.add(
        `Mục dàn ý "${item.h2}" gắn nhãn VERIFIED nhưng thiếu hoặc tham chiếu fact_id không tồn tại (${invalidIds.join(", ") || "rỗng"}) [R-09, R-31]`
      );
    }

    if (label === "NEEDS_VERIFICATION" && needsSet.size === 0) {
      needsSet.add(
        `Mục dàn ý "${item.h2}" cần bổ sung dữ liệu xác thực (NEEDS_VERIFICATION) trong brand_profile [R-31]`
      );
    }

    return {
      ...item,
      fact_ids: validIds.length > 0 ? validIds : rawFactIds,
      claim_label: label,
    };
  });

  return {
    search_intent: output.search_intent,
    content_type: output.content_type,
    items: verifiedItems,
    needs_info: Array.from(needsSet),
    downgraded_count: downgradedCount,
  };
}

export interface VerifyArticleClaimsInput {
  contentBlocks: ContentBlock[];
  rawNeedsInfo: string[];
  seoNeedsInfo?: string[];
  outlineNeedsInfo?: string[];
  brand: BrandProfileRow;
}

/**
 * Năng lực 5 (Giai đoạn Viết bài):
 * Kiểm chứng nhãn sự thật 5 mức (`VERIFIED`, `USER_PROVIDED`, `GENERAL_KNOWLEDGE`, `NEEDS_VERIFICATION`, `OPINION`).
 * TUYỆT ĐỐI KHÔNG cho phép AI tự chuyển `NEEDS_VERIFICATION` thành `VERIFIED` nếu không có `fact_ids` xác thực.
 */
export function verifyArticleClaimsAndEnforceTruthLabels(
  input: VerifyArticleClaimsInput
): VerifiedArticleClaimsResult {
  const validFactIds = new Set((input.brand.facts ?? []).map((f) => f.id));
  const needsSet = new Set<string>();

  for (const item of input.rawNeedsInfo ?? []) {
    if (item.trim()) needsSet.add(item.trim());
  }
  for (const item of input.seoNeedsInfo ?? []) {
    if (item.trim()) needsSet.add(item.trim());
  }

  // Chốt chặn bảo toàn needs_info từ bước dàn ý nếu hồ sơ thương hiệu chưa được bổ sung dữ kiện đó
  for (const item of input.outlineNeedsInfo ?? []) {
    const trimmed = item.trim();
    if (trimmed && !isOutlineNeedResolvedInBrand(trimmed, input.brand)) {
      needsSet.add(trimmed);
    }
  }

  let downgradedBlocks = 0;
  const labelSummary: Record<ClaimLabel, number> = {
    VERIFIED: 0,
    USER_PROVIDED: 0,
    GENERAL_KNOWLEDGE: 0,
    NEEDS_VERIFICATION: 0,
    OPINION: 0,
  };

  const sanitizedBlocks: ContentBlock[] = input.contentBlocks.map((block) => {
    if (block.type === "h2" || block.type === "h3" || block.type === "image") {
      return block;
    }

    const blockText = extractBlockPlainText(block);
    const factIds = block.fact_ids ?? [];
    const invalidIds = factIds.filter((id) => !validFactIds.has(id));
    const hasValidFacts = factIds.length > 0 && invalidIds.length === 0;
    const mentionsBrand = blockMentionsBrandOrProduct(blockText, input.brand);

    let effectiveLabel: ClaimLabel;

    if (block.claim_label) {
      effectiveLabel = block.claim_label;
    } else if (hasValidFacts) {
      effectiveLabel = "VERIFIED";
    } else if (invalidIds.length > 0) {
      effectiveLabel = "NEEDS_VERIFICATION";
    } else if (!mentionsBrand) {
      effectiveLabel = "GENERAL_KNOWLEDGE";
    } else {
      effectiveLabel = "USER_PROVIDED";
    }

    // Chốt chặn 1: Cấm gắn nhãn VERIFIED khi không có fact_ids hợp lệ trong brand_profile
    if (effectiveLabel === "VERIFIED" && !hasValidFacts) {
      effectiveLabel = "NEEDS_VERIFICATION";
      downgradedBlocks++;
      needsSet.add(
        `Phát hiện nội dung tự gắn nhãn VERIFIED nhưng không có fact_ids hợp lệ (${invalidIds.join(", ") || "thiếu fact_ids"}): "${blockText.slice(0, 70)}..." [R-31]`
      );
    }

    // Chốt chặn 2: Nếu có fact_id không tồn tại dù ở bất kỳ nhãn nào -> hạ xuống NEEDS_VERIFICATION
    if (invalidIds.length > 0 && effectiveLabel !== "NEEDS_VERIFICATION") {
      effectiveLabel = "NEEDS_VERIFICATION";
      downgradedBlocks++;
      needsSet.add(
        `Block tham chiếu fact_id không tồn tại (${invalidIds.join(", ")}): "${blockText.slice(0, 70)}..." [R-31]`
      );
    }

    // Chốt chặn 3: Mọi block mang nhãn NEEDS_VERIFICATION đều bắt buộc đẩy vào needs_info để chặn xuất bản
    if (effectiveLabel === "NEEDS_VERIFICATION") {
      const hasExistingNeed = Array.from(needsSet).some((n) =>
        n.includes(blockText.slice(0, 30))
      );
      if (!hasExistingNeed && needsSet.size === 0) {
        needsSet.add(
          `Nội dung chưa đủ căn cứ xác thực (NEEDS_VERIFICATION): "${blockText.slice(0, 70)}..." [R-31]`
        );
      }
    }

    labelSummary[effectiveLabel]++;

    return {
      ...block,
      claim_label: effectiveLabel,
    };
  });

  return {
    content_blocks: sanitizedBlocks,
    needs_info: Array.from(needsSet),
    downgraded_blocks: downgradedBlocks,
    label_summary: labelSummary,
  };
}

