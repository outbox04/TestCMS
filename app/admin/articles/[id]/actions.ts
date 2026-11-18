"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import sharp from "sharp";
import { z } from "zod";
import { processNextAgentJob, slugifyVietnamese } from "@/lib/agent/worker";
import { runAllArticleChecks } from "@/lib/checks";
import { CHECK_CONFIG } from "@/lib/checks/config";
import { processImageForAnalysis } from "@/lib/images/processor";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  ArticleOutlinePayloadSchema,
  ContentBlockSchema,
  OutlineItemSchema,
  type ArticleAssetRow,
  type ArticleRow,
  type ArticleStatus,
  type BrandProfileRow,
  type CheckReport,
  type OutlineItem,
} from "@/lib/supabase/types";
import { verifyArticleClaimsAndEnforceTruthLabels } from "@/lib/writing-engine";

export async function saveOutlineReviewAction(
  formData: FormData
): Promise<void> {
  const articleId = String(formData.get("article_id") ?? "").trim();
  const primaryKeyword = String(formData.get("primary_keyword") ?? "").trim();
  const secondaryRaw = String(formData.get("secondary_keywords") ?? "");
  const faqRaw = String(formData.get("faq_questions") ?? "");
  const outlineJsonRaw = String(formData.get("outline_json") ?? "[]");

  const secondaryKeywords = secondaryRaw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, CHECK_CONFIG.MAX_SECONDARY_KEYWORDS);

  const faqQuestions = faqRaw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, CHECK_CONFIG.MAX_FAQ_COUNT);

  let parsedOutlineItems: OutlineItem[] = [];
  let existingNeedsInfo: string[] = [];

  try {
    const rawObj: unknown = JSON.parse(outlineJsonRaw);
    if (Array.isArray(rawObj)) {
      parsedOutlineItems = z.array(OutlineItemSchema).parse(rawObj);
    } else {
      const payload = ArticleOutlinePayloadSchema.parse(rawObj);
      parsedOutlineItems = payload.items;
      existingNeedsInfo = payload.needs_info;
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Định dạng JSON dàn ý không hợp lệ";
    redirect(
      `/admin/articles/${articleId}?error=${encodeURIComponent(msg)}`
    );
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("articles")
    .update({
      primary_keyword: primaryKeyword,
      secondary_keywords: secondaryKeywords,
      faq_questions: faqQuestions,
      outline: {
        items: parsedOutlineItems,
        needs_info: existingNeedsInfo,
      },
    })
    .eq("id", articleId);

  if (error) {
    redirect(
      `/admin/articles/${articleId}?error=${encodeURIComponent(error.message)}`
    );
  }

  revalidatePath(`/admin/articles/${articleId}`);
  redirect(
    `/admin/articles/${articleId}?notice=${encodeURIComponent(
      "Đã lưu chỉnh sửa dàn ý & từ khóa"
    )}`
  );
}

export interface SaveAndValidateContentInput {
  articleId: string;
  slugInput?: string;
  seoTitle: string;
  seoMetaDescription: string;
  rawBlocksJson: string;
  editorClient?: SupabaseClient;
}

export interface SaveAndValidateContentResult {
  passed: boolean;
  slug: string;
  checkReport: CheckReport;
}

/**
 * Lưu chỉnh sửa trực tiếp nội dung bài viết (SEO + Content Blocks) của Editor,
 * đồng thời chạy ngay Truth Guard (Năng lực 5) và 6 kiểm tra tự động + chấm điểm 100 điểm.
 */
export async function saveAndValidateArticleContent(
  input: SaveAndValidateContentInput
): Promise<SaveAndValidateContentResult> {
  const parsedBlocks = z
    .array(ContentBlockSchema)
    .min(1, "Bài viết phải có ít nhất 1 khối nội dung")
    .parse(JSON.parse(input.rawBlocksJson));

  const supabase = input.editorClient ?? (await createServerSupabaseClient());
  const admin = createAdminSupabaseClient();

  const { data: articleData, error: artErr } = await supabase
    .from("articles")
    .select("*")
    .eq("id", input.articleId)
    .maybeSingle();

  if (artErr || !articleData) {
    throw new Error(artErr?.message ?? "Không tìm thấy bài viết");
  }

  const article = articleData as ArticleRow;
  const cleanSlug =
    slugifyVietnamese(
      input.slugInput?.trim() ||
        article.slug ||
        article.primary_keyword ||
        article.topic
    ) || `bai-viet-${article.id.slice(0, 6)}`;

  const { data: brandData, error: brandErr } = await supabase
    .from("brand_profile")
    .select("*")
    .eq("id", true)
    .single();

  if (brandErr || !brandData) {
    throw new Error("Không đọc được hồ sơ thương hiệu (brand_profile)");
  }
  const brand = brandData as BrandProfileRow;

  const { data: assetsData } = await supabase
    .from("article_assets")
    .select("id, alt_text")
    .eq("article_id", article.id);

  const assets = (assetsData ?? []) as Pick<ArticleAssetRow, "id" | "alt_text">[];

  let outlineNeedsInfo: string[] = [];
  if (article.outline && !Array.isArray(article.outline)) {
    const parsedOutline = ArticleOutlinePayloadSchema.safeParse(article.outline);
    if (parsedOutline.success) {
      outlineNeedsInfo = parsedOutline.data.needs_info;
    }
  }

  const verifiedClaims = verifyArticleClaimsAndEnforceTruthLabels({
    contentBlocks: parsedBlocks,
    rawNeedsInfo: [],
    seoNeedsInfo: [],
    outlineNeedsInfo,
    brand,
  });

  const seoPayload = {
    title: input.seoTitle.trim(),
    meta_description: input.seoMetaDescription.trim(),
    needs_info: verifiedClaims.needs_info,
  };

  const checkReport = runAllArticleChecks({
    topic: article.topic,
    primaryKeyword: article.primary_keyword ?? article.topic,
    secondaryKeywords: article.secondary_keywords ?? [],
    slug: cleanSlug,
    seo: seoPayload,
    contentBlocks: verifiedClaims.content_blocks,
    needsInfo: verifiedClaims.needs_info,
    brandProfile: brand,
    assets,
  });

  // 1. Cập nhật các cột thuộc quyền của Editor qua client người dùng (tuân thủ RLS)
  const { error: editorUpdErr } = await supabase
    .from("articles")
    .update({
      slug: cleanSlug,
      seo: seoPayload,
      content_blocks: verifiedClaims.content_blocks,
    })
    .eq("id", article.id);

  if (editorUpdErr) {
    throw new Error(`Lỗi lưu nội dung bài viết: ${editorUpdErr.message}`);
  }

  const failedMessages = checkReport.items
    .filter((i) => !i.passed)
    .map((i) => `- [${i.code}] ${i.message}`);

  // 2. Cập nhật kết quả kiểm tra tự động qua admin client
  const { error: adminUpdErr } = await admin
    .from("articles")
    .update({
      checks_passed: checkReport.passed,
      check_report: checkReport,
      last_error: checkReport.passed
        ? null
        : `Kiểm tra tự động sau khi sửa chưa đạt: ${failedMessages.join(" | ")}`,
    })
    .eq("id", article.id);

  if (adminUpdErr) {
    throw new Error(`Lỗi cập nhật báo cáo kiểm tra: ${adminUpdErr.message}`);
  }

  return {
    passed: checkReport.passed,
    slug: cleanSlug,
    checkReport,
  };
}

export async function savePreviewContentAction(
  formData: FormData
): Promise<void> {
  const articleId = String(formData.get("article_id") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const seoTitle = String(formData.get("seo_title") ?? "").trim();
  const seoMetaDescription = String(
    formData.get("seo_meta_description") ?? ""
  ).trim();
  const rawBlocksJson = String(formData.get("content_blocks_json") ?? "[]");

  let result: SaveAndValidateContentResult;
  try {
    result = await saveAndValidateArticleContent({
      articleId,
      slugInput,
      seoTitle,
      seoMetaDescription,
      rawBlocksJson,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Lỗi lưu chỉnh sửa nội dung bài viết";
    redirect(`/admin/articles/${articleId}?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath(`/admin/articles/${articleId}`);
  revalidatePath("/admin/articles");

  const scoreText = result.checkReport.quality_score
    ? ` (Điểm chất lượng: ${result.checkReport.quality_score.total_score}/100 — ${result.checkReport.quality_score.band_label})`
    : "";

  if (result.passed) {
    redirect(
      `/admin/articles/${articleId}?notice=${encodeURIComponent(
        `Đã lưu chỉnh sửa nội dung & vượt qua 6/6 kiểm tra tự động${scoreText}!`
      )}`
    );
  } else {
    redirect(
      `/admin/articles/${articleId}?error=${encodeURIComponent(
        `Đã lưu nội dung nhưng kiểm tra tự động chưa đạt${scoreText}. Vui lòng xem chi tiết bên dưới.`
      )}`
    );
  }
}

export async function transitionArticleAction(
  formData: FormData
): Promise<void> {
  const articleId = String(formData.get("article_id") ?? "").trim();
  const toStatus = String(formData.get("to_status") ?? "").trim() as ArticleStatus;
  const expectedVersion = Number(formData.get("expected_version") ?? 0);
  const note = String(formData.get("note") ?? "").trim() || null;
  const scheduledAtRaw = String(formData.get("scheduled_at") ?? "").trim();

  const supabase = await createServerSupabaseClient();

  if (toStatus === "scheduled") {
    if (!scheduledAtRaw) {
      redirect(
        `/admin/articles/${articleId}?error=${encodeURIComponent(
          "Vui lòng chọn thời điểm lên lịch đăng"
        )}`
      );
    }
    const parsedTime = Date.parse(scheduledAtRaw);
    if (Number.isNaN(parsedTime)) {
      redirect(
        `/admin/articles/${articleId}?error=${encodeURIComponent(
          "Thời điểm lên lịch không hợp lệ"
        )}`
      );
    }
    const { error: schedErr } = await supabase
      .from("articles")
      .update({
        scheduled_at: new Date(parsedTime).toISOString(),
      })
      .eq("id", articleId);

    if (schedErr) {
      redirect(
        `/admin/articles/${articleId}?error=${encodeURIComponent(
          schedErr.message
        )}`
      );
    }
  }

  // Mọi thao tác đổi trạng thái bắt buộc đi qua RPC transition_article kèm expected_version (R-36, R-37)
  const { error } = await supabase.rpc("transition_article", {
    p_article_id: articleId,
    p_to: toStatus,
    p_expected_version: expectedVersion,
    p_actor_kind: "editor",
    p_note: note,
  });

  if (error) {
    redirect(
      `/admin/articles/${articleId}?error=${encodeURIComponent(error.message)}`
    );
  }

  // Tự động kích hoạt Agent Worker khi chuyển sang bước của Agent (outline_draft, analyzing_images, writing)
  let autoNotice = `Đã chuyển trạng thái bài viết sang "${toStatus}"`;
  try {
    if (toStatus === "outline_draft" || toStatus === "writing") {
      const r1 = await processNextAgentJob();
      if (r1.processed) autoNotice = r1.detail;
    } else if (toStatus === "analyzing_images") {
      // Chạy liên hoàn: Phân tích ảnh (analyzing_images -> writing) rồi Viết bài + Kiểm tra tự động (writing -> preview_review)
      const r1 = await processNextAgentJob();
      const r2 = await processNextAgentJob();
      if (r2.processed) {
        autoNotice = `${r1.detail} → ${r2.detail}`;
      } else if (r1.processed) {
        autoNotice = r1.detail;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi chạy Agent tự động";
    revalidatePath(`/admin/articles/${articleId}`);
    redirect(`/admin/articles/${articleId}?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath(`/admin/articles/${articleId}`);
  revalidatePath("/admin/articles");
  revalidatePath("/blog");

  redirect(
    `/admin/articles/${articleId}?notice=${encodeURIComponent(autoNotice)}`
  );
}

export async function uploadArticleImageAction(
  formData: FormData
): Promise<void> {
  const articleId = String(formData.get("article_id") ?? "").trim();
  const fileEntry = formData.get("image");

  if (!fileEntry || !(fileEntry instanceof File) || fileEntry.size === 0) {
    redirect(
      `/admin/articles/${articleId}?error=${encodeURIComponent(
        "Vui lòng chọn file ảnh để tải lên"
      )}`
    );
  }

  const supabase = await createServerSupabaseClient();
  const inputBuffer = Buffer.from(await fileEntry.arrayBuffer());

  let processed;
  try {
    processed = await processImageForAnalysis(
      inputBuffer,
      CHECK_CONFIG.IMAGE_MAX_EDGE
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi xử lý ảnh bằng sharp";
    redirect(`/admin/articles/${articleId}?error=${encodeURIComponent(msg)}`);
  }

  // Nếu ảnh trùng sha256 trong cùng bài viết thì bỏ qua (R-13)
  const { data: existingDuplicate } = await supabase
    .from("article_assets")
    .select("id")
    .eq("article_id", articleId)
    .eq("sha256", processed.sha256)
    .maybeSingle();

  if (existingDuplicate) {
    redirect(
      `/admin/articles/${articleId}?notice=${encodeURIComponent(
        `Ảnh trùng mã băm sha256 (${processed.sha256.slice(0, 12)}...) trong cùng bài viết — đã bỏ qua.`
      )}`
    );
  }

  const ext = (fileEntry.name.split(".").pop() || "bin")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const shortHash = processed.sha256.slice(0, 16);
  const storagePath = `${articleId}/orig-${shortHash}.${ext || "img"}`;
  const analysisPath = `${articleId}/analysis-${shortHash}.jpg`;

  const { error: upOrigErr } = await supabase.storage
    .from("article-images")
    .upload(storagePath, inputBuffer, {
      contentType: fileEntry.type || "application/octet-stream",
      upsert: true,
    });

  if (upOrigErr) {
    redirect(
      `/admin/articles/${articleId}?error=${encodeURIComponent(
        `Lỗi tải ảnh gốc lên bucket article-images: ${upOrigErr.message}`
      )}`
    );
  }

  const { error: upAnalysisErr } = await supabase.storage
    .from("article-images")
    .upload(analysisPath, processed.analysisJpegBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (upAnalysisErr) {
    redirect(
      `/admin/articles/${articleId}?error=${encodeURIComponent(
        `Lỗi tải bản phân tích JPEG lên bucket article-images: ${upAnalysisErr.message}`
      )}`
    );
  }

  const { error: insertErr } = await supabase.from("article_assets").insert({
    article_id: articleId,
    storage_path: storagePath,
    analysis_path: analysisPath,
    sha256: processed.sha256,
    width: processed.originalWidth,
    height: processed.originalHeight,
  });

  if (insertErr) {
    redirect(
      `/admin/articles/${articleId}?error=${encodeURIComponent(
        insertErr.message
      )}`
    );
  }

  revalidatePath(`/admin/articles/${articleId}`);
  redirect(
    `/admin/articles/${articleId}?notice=${encodeURIComponent(
      `Đã tải lên ảnh (${processed.originalWidth}x${processed.originalHeight} -> bản phân tích JPEG ${processed.analysisWidth}x${processed.analysisHeight} <= ${CHECK_CONFIG.IMAGE_MAX_EDGE}px, sha256: ${shortHash}...)`
    )}`
  );
}

export async function uploadDemoSampleImageAction(
  formData: FormData
): Promise<void> {
  const articleId = String(formData.get("article_id") ?? "").trim();
  const supabase = await createServerSupabaseClient();

  const samplePngBuffer = await sharp({
    create: {
      width: 2400,
      height: 1600,
      channels: 3,
      background: { r: 215, g: 228, b: 242 },
    },
  })
    .png()
    .toBuffer();

  const processed = await processImageForAnalysis(
    samplePngBuffer,
    CHECK_CONFIG.IMAGE_MAX_EDGE
  );

  const { data: existingDuplicate } = await supabase
    .from("article_assets")
    .select("id")
    .eq("article_id", articleId)
    .eq("sha256", processed.sha256)
    .maybeSingle();

  if (existingDuplicate) {
    redirect(
      `/admin/articles/${articleId}?notice=${encodeURIComponent(
        `Ảnh mẫu trùng mã băm sha256 (${processed.sha256.slice(0, 12)}...) trong cùng bài viết — đã bỏ qua (R-13).`
      )}`
    );
  }

  const shortHash = processed.sha256.slice(0, 16);
  const storagePath = `${articleId}/orig-${shortHash}.png`;
  const analysisPath = `${articleId}/analysis-${shortHash}.jpg`;

  await supabase.storage
    .from("article-images")
    .upload(storagePath, samplePngBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  await supabase.storage
    .from("article-images")
    .upload(analysisPath, processed.analysisJpegBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  await supabase.from("article_assets").insert({
    article_id: articleId,
    storage_path: storagePath,
    analysis_path: analysisPath,
    sha256: processed.sha256,
    width: processed.originalWidth,
    height: processed.originalHeight,
  });

  revalidatePath(`/admin/articles/${articleId}`);
  redirect(
    `/admin/articles/${articleId}?notice=${encodeURIComponent(
      `Đã tạo & nạp ảnh mẫu Demo (${processed.originalWidth}x${processed.originalHeight}px -> resize JPEG ${processed.analysisWidth}x${processed.analysisHeight}px <= ${CHECK_CONFIG.IMAGE_MAX_EDGE}px, sha256: ${shortHash}...)`
    )}`
  );
}


