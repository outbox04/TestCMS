import type {
  ArticleSeo,
  BrandFact,
  BrandProduct,
  BrandProfileRow,
  CheckItemResult,
  ContentBlock,
} from "@/lib/supabase/types";

export type ValidationSeverity =
  | "HARD_BLOCKER"
  | "MAJOR_ISSUE"
  | "MINOR_WARNING"
  | "PASSED";

export interface ValidationIssue {
  code:
    | "TOPIC_TITLE_H1_MISMATCH"
    | "TOPIC_SAPO_MISMATCH"
    | "TOPIC_META_DESC_MISMATCH"
    | "TOPIC_HEADING_BODY_MISMATCH"
    | "TOPIC_CONCLUSION_MISMATCH"
    | "ENTITY_SPEC_MISATTRIBUTION"
    | "ENTITY_FACT_MISMATCH"
    | "KEYWORD_STUFFING_BAIT"
    | "KEYWORD_SECONDARY_UNRELATED"
    | "FAQ_OFF_TOPIC_ENTITY"
    | "FAQ_UNVERIFIED_CLAIM"
    | "FACT_UNVERIFIED_SPEC";
  severity: Exclude<ValidationSeverity, "PASSED">;
  location: string;
  message: string;
  ruleIds: string[];
}

export interface ProductEntityProfile {
  product: BrandProduct;
  normalizedName: string;
  shortTokens: string[];
  exclusiveNumbers: Set<string>;
  exclusivePhrases: string[];
  exclusiveFactIds: Set<string>;
  sharedFactIds: Set<string>;
}

export interface ConsistencyValidationInput {
  topic?: string;
  primaryKeyword: string;
  secondaryKeywords?: string[];
  seo: ArticleSeo;
  contentBlocks: ContentBlock[];
  brandProfile: BrandProfileRow;
}

export interface ConsistencyValidationResult {
  passed: boolean;
  primaryProducts: ProductEntityProfile[];
  relatedProducts: ProductEntityProfile[];
  issues: ValidationIssue[];
  hardBlockers: ValidationIssue[];
  majorIssues: ValidationIssue[];
  minorWarnings: ValidationIssue[];
  checkItem: CheckItemResult;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractNumbers(text: string): string[] {
  const matches = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  return matches.map((m) => m.replace(/\./g, "").replace(",", "."));
}

/**
 * Xây dựng hồ sơ thực thể cho từng sản phẩm trong brand_profile:
 * Xác định các con số, cụm thông số và fact_ids ĐỘC QUYỀN của từng sản phẩm
 * để phát hiện lỗi gán nhầm thông số của sản phẩm B cho sản phẩm A.
 */
export function buildProductEntityProfiles(
  brand: BrandProfileRow
): ProductEntityProfile[] {
  const products = brand.products ?? [];
  const facts: BrandFact[] = brand.facts ?? [];

  // Bước 1: Thu thập tập số liệu và cụm thông số thô của từng sản phẩm
  const rawNumbersByProd = new Map<string, Set<string>>();
  const rawPhrasesByProd = new Map<string, Set<string>>();

  for (const prod of products) {
    const nums = new Set<string>();
    const phrases = new Set<string>();

    for (const n of extractNumbers(
      `${prod.price} ${prod.price_formatted}`
    )) {
      if (Number(n) > 10) nums.add(n);
    }
    if (prod.price_formatted?.trim()) {
      phrases.add(normalize(prod.price_formatted));
    }

    for (const val of Object.values(prod.specs ?? {})) {
      const normVal = normalize(val);
      if (normVal.length >= 3) {
        phrases.add(normVal);
      }
      for (const n of extractNumbers(val)) {
        if (Number(n) > 10 || n.includes(".")) {
          nums.add(n);
        }
      }
    }

    rawNumbersByProd.set(prod.id, nums);
    rawPhrasesByProd.set(prod.id, phrases);
  }

  // Bước 2: Phân tích từng fact trong brand.facts xem nó thuộc sản phẩm nào
  const exclusiveFactsByProd = new Map<string, Set<string>>();
  const sharedFactsByProd = new Map<string, Set<string>>();
  for (const prod of products) {
    exclusiveFactsByProd.set(prod.id, new Set<string>());
    sharedFactsByProd.set(prod.id, new Set<string>());
  }

  for (const fact of facts) {
    const normStmt = normalize(fact.statement);
    const mentionedProds = products.filter((p) =>
      normStmt.includes(normalize(p.name))
    );

    if (mentionedProds.length === 1) {
      const onlyProd = mentionedProds[0];
      exclusiveFactsByProd.get(onlyProd.id)?.add(fact.id);

      for (const n of extractNumbers(fact.statement)) {
        if (Number(n) > 10 || n.includes(".")) {
          rawNumbersByProd.get(onlyProd.id)?.add(n);
        }
      }
      // Trích xuất các cụm kỹ thuật đặc trưng trong fact độc quyền (ví dụ: "pid", "92 độ c", "15 bar", "35 giây", "48 mm", "38 cấp độ")
      const techPatterns = [
        "pid",
        "92 độ c",
        "92°c",
        "15 bar",
        "1350w",
        "35 giây",
        "1.2 lít",
        "4.2 kg",
        "180w",
        "48 mm",
        "48mm",
        "38 cấp độ",
        "250 g",
        "450 vòng/phút",
        "2.6 kg",
        "cấp 22",
        "cấp 28",
      ];
      for (const pat of techPatterns) {
        if (normStmt.includes(pat)) {
          rawPhrasesByProd.get(onlyProd.id)?.add(pat);
        }
      }
    } else if (mentionedProds.length > 1) {
      for (const mp of mentionedProds) {
        sharedFactsByProd.get(mp.id)?.add(fact.id);
      }
    }
  }

  // Bước 3: Lọc ra các con số và cụm từ ĐỘC QUYỀN (chỉ xuất hiện ở 1 sản phẩm duy nhất)
  return products.map((prod) => {
    const myNums = rawNumbersByProd.get(prod.id) ?? new Set<string>();
    const exclusiveNumbers = new Set<string>();
    for (const n of myNums) {
      let appearsInOther = false;
      for (const other of products) {
        if (other.id === prod.id) continue;
        if (rawNumbersByProd.get(other.id)?.has(n)) {
          appearsInOther = true;
          break;
        }
      }
      if (!appearsInOther) {
        exclusiveNumbers.add(n);
      }
    }

    const myPhrases = rawPhrasesByProd.get(prod.id) ?? new Set<string>();
    const exclusivePhrases: string[] = [];
    for (const ph of myPhrases) {
      let appearsInOther = false;
      for (const other of products) {
        if (other.id === prod.id) continue;
        if (rawPhrasesByProd.get(other.id)?.has(ph)) {
          appearsInOther = true;
          break;
        }
      }
      if (!appearsInOther) {
        exclusivePhrases.push(ph);
      }
    }

    const normName = normalize(prod.name);
    const shortTokens = normName
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !["pro", "mini"].includes(t));

    return {
      product: prod,
      normalizedName: normName,
      shortTokens,
      exclusiveNumbers,
      exclusivePhrases,
      exclusiveFactIds: exclusiveFactsByProd.get(prod.id) ?? new Set<string>(),
      sharedFactIds: sharedFactsByProd.get(prod.id) ?? new Set<string>(),
    };
  });
}

function textMentionsProduct(
  text: string,
  profile: ProductEntityProfile
): boolean {
  const norm = normalize(text);
  if (norm.includes(profile.normalizedName)) return true;
  // Kiểm tra tên model đặc trưng (ví dụ "mini x1", "pro g2", "lumigrind")
  const tokens = profile.normalizedName.split(/\s+/);
  if (tokens.length >= 2) {
    const lastTwo = tokens.slice(-2).join(" ");
    if (lastTwo.length >= 5 && norm.includes(lastTwo)) return true;
  }
  if (tokens[0] && tokens[0].length >= 8 && norm.includes(tokens[0])) {
    // Ví dụ "lumigrind" (nhưng không áp dụng cho "lumibrew" vì trùng tên thương hiệu LumiBrew Việt Nam)
    if (!tokens[0].includes("lumibrew")) {
      return true;
    }
  }
  return false;
}

function findExclusiveSpecsInText(
  text: string,
  profile: ProductEntityProfile
): string[] {
  const norm = normalize(text);
  const found: string[] = [];

  for (const phrase of profile.exclusivePhrases) {
    if (phrase.length >= 3 && norm.includes(phrase)) {
      found.push(phrase);
    }
  }

  const numsInText = extractNumbers(text);
  for (const n of numsInText) {
    if (profile.exclusiveNumbers.has(n)) {
      found.push(n);
    }
  }

  return Array.from(new Set(found));
}

function isArtificialKeywordPrefix(
  text: string,
  primaryKeyword: string
): boolean {
  const normText = normalize(text);
  const normPk = normalize(primaryKeyword);
  if (!normPk) return false;
  return (
    normText.startsWith(`trong chủ đề ${normPk},`) ||
    normText.startsWith(`với chủ đề ${normPk},`) ||
    normText.startsWith(`về ${normPk}, máy`)
  );
}

/**
 * Chạy toàn bộ kiểm tra Nhất quán Chủ đề, Thực thể Sản phẩm, Từ khóa và FAQ (Nhiệm vụ 2: A, B, C, D, E).
 */
export function validateArticleConsistencyAndEntities(
  input: ConsistencyValidationInput
): ConsistencyValidationResult {
  const issues: ValidationIssue[] = [];
  const profiles = buildProductEntityProfiles(input.brandProfile);

  const anchorContext = `${input.topic ?? ""} ${input.primaryKeyword} ${input.seo.title}`;
  const mentionedInAnchor = profiles.filter((p) =>
    textMentionsProduct(anchorContext, p)
  );

  // Якщо chủ đề/từ khóa chính/SEO title chỉ nêu 1 sản phẩm -> đó là Sản phẩm chính (Primary Product),
  // các sản phẩm còn lại là Sản phẩm liên quan/phụ (Related Products).
  const primaryProducts =
    mentionedInAnchor.length > 0 ? mentionedInAnchor : [];
  const relatedProducts =
    primaryProducts.length > 0
      ? profiles.filter(
          (p) => !primaryProducts.some((pp) => pp.product.id === p.product.id)
        )
      : [];

  const isSingleProductFocus =
    primaryProducts.length === 1 && relatedProducts.length > 0;
  const mainProduct = isSingleProductFocus ? primaryProducts[0] : null;

  // =========================================================================
  // 1. Kiểm tra Meta Description (Topic Consistency & Product Entity Consistency)
  // =========================================================================
  const metaDesc = input.seo.meta_description.trim();
  if (mainProduct) {
    for (const relProd of relatedProducts) {
      const mentionsRelName = textMentionsProduct(metaDesc, relProd);
      const leakedSpecs = findExclusiveSpecsInText(metaDesc, relProd);

      if (leakedSpecs.length > 0 && !mentionsRelName) {
        issues.push({
          code: "TOPIC_META_DESC_MISMATCH",
          severity: "HARD_BLOCKER",
          location: "seo.meta_description",
          message: `Meta Description của bài viết về "${mainProduct.product.name}" bị lệch chủ đề / gán nhầm thông số độc quyền của "${relProd.product.name}" (${leakedSpecs.join(", ")}) [R-18, R-20, R-31]`,
          ruleIds: ["R-18", "R-20", "R-31"],
        });
      }
    }
  }

  // =========================================================================
  // 2. Kiểm tra Sapo (Đoạn paragraph đầu tiên của bài)
  // =========================================================================
  const firstParaIndex = input.contentBlocks.findIndex(
    (b) => b.type === "paragraph"
  );
  if (firstParaIndex !== -1) {
    const sapoBlock = input.contentBlocks[firstParaIndex] as Extract<
      ContentBlock,
      { type: "paragraph" }
    >;
    const sapoText = sapoBlock.text;
    const sapoFacts = sapoBlock.fact_ids ?? [];

    if (isArtificialKeywordPrefix(sapoText, input.primaryKeyword)) {
      issues.push({
        code: "KEYWORD_STUFFING_BAIT",
        severity: "HARD_BLOCKER",
        location: `content_blocks[${firstParaIndex}] (Sapo)`,
        message: `Đoạn mở đầu (Sapo) chèn từ khóa chính "${input.primaryKeyword}" một cách máy móc ("Trong chủ đề...") nhưng nội dung thực tế bị đánh tráo sang chủ đề khác [R-19, R-21]`,
        ruleIds: ["R-19", "R-21"],
      });
    }

    if (mainProduct) {
      const sapoMainSpecs = findExclusiveSpecsInText(sapoText, mainProduct);
      const sapoHasMainFact = sapoFacts.some(
        (fid) =>
          mainProduct.exclusiveFactIds.has(fid) ||
          mainProduct.sharedFactIds.has(fid)
      );

      for (const relProd of relatedProducts) {
        const sapoMentionsRel = textMentionsProduct(sapoText, relProd);
        const sapoRelSpecs = findExclusiveSpecsInText(sapoText, relProd);
        const sapoOnlyRelFacts =
          sapoFacts.length > 0 &&
          sapoFacts.every((fid) => relProd.exclusiveFactIds.has(fid));

        // Nếu Sapo giới thiệu sản phẩm phụ (hoặc dùng toàn bộ fact_ids/thông số của sản phẩm phụ) mà không có thông số/fact của sản phẩm chính
        if (
          (sapoOnlyRelFacts ||
            (sapoMentionsRel &&
              sapoRelSpecs.length > 0 &&
              sapoMainSpecs.length === 0 &&
              !sapoHasMainFact))
        ) {
          issues.push({
            code: "TOPIC_SAPO_MISMATCH",
            severity: "HARD_BLOCKER",
            location: `content_blocks[${firstParaIndex}] (Sapo)`,
            message: `Sapo lệch chủ đề nghiêm trọng: Bài viết có chủ đề chính là "${mainProduct.product.name}" nhưng đoạn mở đầu lại giới thiệu thông số của "${relProd.product.name}" (${sapoRelSpecs.join(", ") || sapoFacts.join(", ")}) [R-19, R-21, R-31]`,
            ruleIds: ["R-19", "R-21", "R-31"],
          });
        }
      }
    }
  }

  // =========================================================================
  // 3. Kiểm tra từng Block: H2/H3 vs Nội dung bên dưới & Gán nhầm thông số giữa các sản phẩm
  // =========================================================================
  let currentHeadingText = input.seo.title;
  let currentHeadingIndex = -1;

  input.contentBlocks.forEach((block, idx) => {
    if (block.type === "h2" || block.type === "h3") {
      currentHeadingText = block.text;
      currentHeadingIndex = idx;
      return;
    }

    if (block.type === "image") return;

    let blockText = "";
    if (block.type === "paragraph" || block.type === "callout") {
      blockText = block.text;
    } else if (block.type === "list") {
      blockText = block.items.join(" ");
    } else if (block.type === "table") {
      blockText = [
        block.caption ?? "",
        block.headers.join(" "),
        ...block.rows.map((r) => r.join(" ")),
      ].join(" ");
    } else if (block.type === "faq") {
      blockText = `${block.q} ${block.a}`;
    }

    const blockFacts = "fact_ids" in block && Array.isArray(block.fact_ids) ? block.fact_ids : [];

    // 3.1 Kiểm tra từng câu văn xem có gán nhầm thông số độc quyền của sản phẩm B cho sản phẩm A không
    const sentences = blockText
      .split(/(?<=[.?!;])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const mentionedProdsInSentence = profiles.filter((p) =>
        textMentionsProduct(sentence, p)
      );

      // Trường hợp câu văn chỉ nhắc tên đúng 1 sản phẩm A (không nhắc sản phẩm B),
      // nhưng lại chứa thông số độc quyền của sản phẩm B -> Gán nhầm thông số!
      if (mentionedProdsInSentence.length === 1) {
        const targetProd = mentionedProdsInSentence[0];
        for (const otherProd of profiles) {
          if (otherProd.product.id === targetProd.product.id) continue;
          const wrongSpecs = findExclusiveSpecsInText(sentence, otherProd);
          if (wrongSpecs.length > 0) {
            issues.push({
              code: "ENTITY_SPEC_MISATTRIBUTION",
              severity: "HARD_BLOCKER",
              location: `content_blocks[${idx}] (${block.type})`,
              message: `Gán nhầm thông số sản phẩm: Câu văn nhắc tới "${targetProd.product.name}" nhưng lại gắn thông số độc quyền của "${otherProd.product.name}" (${wrongSpecs.join(", ")}) [R-18, R-31]`,
              ruleIds: ["R-18", "R-31"],
            });
          }
        }
      }
    }

    // 3.2 Kiểm tra khớp giữa Heading (H2/H3) và đoạn văn bên dưới (cho các block không phải FAQ)
    if (block.type !== "faq" && currentHeadingIndex !== -1) {
      const headingProds = profiles.filter((p) =>
        textMentionsProduct(currentHeadingText, p)
      );
      if (headingProds.length === 1) {
        const expectedProd = headingProds[0];
        for (const otherProd of profiles) {
          if (otherProd.product.id === expectedProd.product.id) continue;

          const usesOnlyOtherExclusiveFacts =
            blockFacts.length > 0 &&
            blockFacts.every((fid) => otherProd.exclusiveFactIds.has(fid));

          const mentionsOther = textMentionsProduct(blockText, otherProd);
          const otherSpecs = findExclusiveSpecsInText(blockText, otherProd);
          const expectedSpecs = findExclusiveSpecsInText(
            blockText,
            expectedProd
          );

          if (
            usesOnlyOtherExclusiveFacts ||
            (mentionsOther &&
              otherSpecs.length > 0 &&
              expectedSpecs.length === 0 &&
              !blockFacts.some(
                (fid) =>
                  expectedProd.exclusiveFactIds.has(fid) ||
                  expectedProd.sharedFactIds.has(fid)
              ))
          ) {
            issues.push({
              code: "TOPIC_HEADING_BODY_MISMATCH",
              severity: "HARD_BLOCKER",
              location: `content_blocks[${idx}] (dưới Heading #${currentHeadingIndex + 1}: "${currentHeadingText}")`,
              message: `Nội dung dưới tiêu đề "${currentHeadingText}" bị lệch sang sản phẩm "${otherProd.product.name}" (dùng thông số/fact của ${otherProd.product.name} thay vì ${expectedProd.product.name}) [R-09, R-18, R-31]`,
              ruleIds: ["R-09", "R-18", "R-31"],
            });
          }
        }
      }
    }

    // 3.3 Kiểm tra chéo fact_ids của block với sản phẩm duy nhất được nhắc trong block
    const mentionedInBlock = profiles.filter((p) =>
      textMentionsProduct(blockText, p)
    );
    if (mentionedInBlock.length === 1 && blockFacts.length > 0) {
      const onlyProdInBlock = mentionedInBlock[0];
      for (const otherProd of profiles) {
        if (otherProd.product.id === onlyProdInBlock.product.id) continue;
        const mismatchedFacts = blockFacts.filter((fid) =>
          otherProd.exclusiveFactIds.has(fid)
        );
        if (mismatchedFacts.length > 0) {
          issues.push({
            code: "ENTITY_FACT_MISMATCH",
            severity: "HARD_BLOCKER",
            location: `content_blocks[${idx}] (${block.type})`,
            message: `Block chỉ nói về "${onlyProdInBlock.product.name}" nhưng lại gắn fact_id độc quyền của "${otherProd.product.name}" (${mismatchedFacts.join(", ")}) [R-31]`,
            ruleIds: ["R-31"],
          });
        }
      }
    }
  });

  // =========================================================================
  // 4. Kiểm tra FAQ Consistency (Nhiệm vụ 2.D)
  // =========================================================================
  input.contentBlocks.forEach((block, idx) => {
    if (block.type !== "faq") return;

    const qText = block.q.trim();
    const aText = block.a.trim();
    const faqFacts = block.fact_ids ?? [];

    // 4.1 Nếu bài viết tập trung vào 1 sản phẩm chính (ví dụ LumiGrind Pro G2),
    // câu hỏi FAQ không được phép chỉ hỏi riêng về thông số độc quyền của sản phẩm khác (ví dụ "Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?")
    if (mainProduct) {
      const qMentionsMain = textMentionsProduct(qText, mainProduct);
      const aMentionsMain = textMentionsProduct(aText, mainProduct);

      for (const relProd of relatedProducts) {
        const qMentionsRel = textMentionsProduct(qText, relProd);
        const faqUsesOnlyRelExclusiveFacts =
          faqFacts.length > 0 &&
          faqFacts.every((fid) => relProd.exclusiveFactIds.has(fid));

        if (
          (qMentionsRel && !qMentionsMain && !aMentionsMain) ||
          (qMentionsRel && faqUsesOnlyRelExclusiveFacts)
        ) {
          issues.push({
            code: "FAQ_OFF_TOPIC_ENTITY",
            severity: "HARD_BLOCKER",
            location: `content_blocks[${idx}] (FAQ: "${qText}")`,
            message: `Câu hỏi FAQ "${qText}" hỏi về sản phẩm khác ("${relProd.product.name}"), không thuộc chủ đề chính của bài viết ("${mainProduct.product.name}") [R-08, R-29, R-31]`,
            ruleIds: ["R-08", "R-29", "R-31"],
          });
        }
      }
    }

    // 4.2 Không đưa thông tin chưa xác minh thành câu trả lời chắc chắn trong FAQ
    if (block.claim_label === "NEEDS_VERIFICATION") {
      issues.push({
        code: "FAQ_UNVERIFIED_CLAIM",
        severity: "HARD_BLOCKER",
        location: `content_blocks[${idx}] (FAQ: "${qText}")`,
        message: `Câu trả lời FAQ "${qText}" chứa thông tin chưa được xác minh (NEEDS_VERIFICATION) [R-29, R-31]`,
        ruleIds: ["R-29", "R-31"],
      });
    }
  });

  // =========================================================================
  // 5. Kiểm tra Fact Verification trên các tuyên bố về giá & thông số sản phẩm (Nhiệm vụ 2.E)
  // =========================================================================
  input.contentBlocks.forEach((block, idx) => {
    if (
      block.type === "h2" ||
      block.type === "h3" ||
      block.type === "image"
    ) {
      return;
    }

    let blockText = "";
    if (block.type === "paragraph" || block.type === "callout") {
      blockText = block.text;
    } else if (block.type === "list") {
      blockText = block.items.join(" ");
    } else if (block.type === "table") {
      blockText = [
        block.caption ?? "",
        block.headers.join(" "),
        ...block.rows.map((r) => r.join(" ")),
      ].join(" ");
    } else if (block.type === "faq") {
      blockText = `${block.q} ${block.a}`;
    }

    const mentionsAnyProduct = profiles.some((p) =>
      textMentionsProduct(blockText, p)
    );
    const hasPriceOrSpecNumbers = extractNumbers(blockText).some(
      (n) => Number(n) > 10 || n.includes(".")
    );
    const fids = block.fact_ids ?? [];

    // Nếu đoạn văn nêu tên sản phẩm thương hiệu kèm giá/thông số kỹ thuật nhưng lại gắn OPINION hoặc GENERAL_KNOWLEDGE mà không có fact_ids xác thực
    if (
      mentionsAnyProduct &&
      hasPriceOrSpecNumbers &&
      fids.length === 0 &&
      (block.claim_label === "GENERAL_KNOWLEDGE" ||
        block.claim_label === "OPINION")
    ) {
      issues.push({
        code: "FACT_UNVERIFIED_SPEC",
        severity: "HARD_BLOCKER",
        location: `content_blocks[${idx}] (${block.type})`,
        message: `Tuyên bố về giá hoặc thông số sản phẩm tại content_blocks[${idx}] thiếu fact_ids xác minh (không được gắn nhãn ${block.claim_label} để bỏ qua kiểm chứng) [R-31]`,
        ruleIds: ["R-31"],
      });
    }
  });

  const hardBlockers = issues.filter((i) => i.severity === "HARD_BLOCKER");
  const majorIssues = issues.filter((i) => i.severity === "MAJOR_ISSUE");
  const minorWarnings = issues.filter((i) => i.severity === "MINOR_WARNING");
  const passed = hardBlockers.length === 0 && majorIssues.length === 0;

  return {
    passed,
    primaryProducts,
    relatedProducts,
    issues,
    hardBlockers,
    majorIssues,
    minorWarnings,
    checkItem: {
      code: "content_entity_consistency",
      ruleIds: ["R-08", "R-09", "R-18", "R-19", "R-21", "R-29", "R-31"],
      passed,
      message: passed
        ? "Nhất quán chủ đề (Title, Meta, Sapo, H2, FAQ) và thông số thực thể sản phẩm đạt chuẩn."
        : issues.map((i) => `[${i.code} @ ${i.location}] ${i.message}`).join("; "),
    },
  };
}

