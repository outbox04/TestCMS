
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { processNextAgentJob } from "@/lib/agent/worker";
import { createLlmProvider } from "@/lib/llm";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getDemoState, isSupabaseConfigured } from "@/lib/supabase/local-demo-store";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { BrandProfileRow } from "@/lib/supabase/types";
import { buildNonOverlappingTopicSchedule } from "@/lib/writing-engine";

export async function createArticleAction(formData: FormData): Promise<void> {
  const topic = String(formData.get("topic") ?? "").trim();
  const plannedRaw = String(formData.get("planned_publish_at") ?? "").trim();

  if (!topic) {
    redirect(
      "/admin/articles?error=" +
      encodeURIComponent("Vui lòng nhập chủ đề bài viết")
    );
  }

  let plannedIso: string;
  if (plannedRaw && !Number.isNaN(Date.parse(plannedRaw))) {
    plannedIso = new Date(Date.parse(plannedRaw)).toISOString();
  } else {
    // Nếu không nhập ngày dự kiến, Agent tự động xếp lịch vào 09:00 sáng ngày mai
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tomorrow.setHours(9, 0, 0, 0);
    plannedIso = tomorrow.toISOString();
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("articles")
    .insert({
      topic,
      planned_publish_at: plannedIso,
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(
      "/admin/articles?error=" +
      encodeURIComponent(error?.message ?? "Không thể tạo bài viết")
    );
  }

  // Tự động chạy ngay các job chờ trong hàng đợi để AI sinh từ khóa + FAQ + dàn ý và đưa tới CỔNG 1 (outline_review)
  try {
    for (let i = 0; i < 5; i++) {
      const r = await processNextAgentJob();
      if (!r.processed) break;
    }
  } catch {
    // Nếu lỗi tạm thời thì vẫn mở trang chi tiết bài viết để xem last_error
  }

  revalidatePath("/admin/articles");
  redirect(`/admin/articles/${data.id}`);
}

/**
 * AI Agent tự động lập lịch xuất bản (planned_publish_at) và sinh ý chính (plan_outline)
 * dựa trên brand_profile + gợi ý từ khóa, chống trùng lặp chủ đề (R-07) và đưa thẳng các bài tới CỔNG 1 (outline_review).
 */
export async function aiAutoScheduleAndPlanAction(): Promise<void> {
  let createdCount = 0;
  let errorMsg = "";

  try {
    const supabase = await createServerSupabaseClient();
    const { data: brandData } = await supabase
      .from("brand_profile")
      .select("*")
      .eq("id", true)
      .maybeSingle();

    const brand = brandData as BrandProfileRow | null;

    const { data: existingArticlesData } = await supabase
      .from("articles")
      .select("topic");

    const existingTopics = ((existingArticlesData ?? []) as Array<{ topic: string }>).map(
      (a) => a.topic
    );

    let suggestedSchedule = buildNonOverlappingTopicSchedule(
      brand,
      existingTopics,
      3
    );

    // Nếu đã cấu hình API Key thật (không phải LOCAL_DEMO_MODE_KEY), gọi trực tiếp AI (Gemini/OpenAI/Claude)
    // để sáng tạo 3 chủ đề mới dựa trên brand_profile và tránh trùng lặp existingTopics (R-07).
    const admin = createAdminSupabaseClient();
    const { data: currentKey } = await admin.rpc("get_ai_api_key");
    if (
      currentKey &&
      typeof currentKey === "string" &&
      currentKey.trim().length > 0 &&
      currentKey.trim() !== "LOCAL_DEMO_MODE_KEY"
    ) {
      const TopicScheduleSchema = z.object({
        topics: z.array(z.string().min(10)).min(3).max(3),
      });
      const llm = createLlmProvider();
      const aiTopicsRes = await llm.generateStructured({
        step: "plan_topic_schedule",
        schema: TopicScheduleSchema,
        prompt: [
          "Bạn là Chiến lược gia Nội dung SEO/GEO/AEO.",
          "Dựa trên Hồ sơ thương hiệu sau đây:",
          JSON.stringify(brand, null, 2),
          "",
          `Danh sách chủ đề đã có (TUYỆT ĐỐI KHÔNG TRÙNG LẶP): ${JSON.stringify(existingTopics)}`,
          "",
          'Hãy đề xuất đúng 3 chủ đề bài viết mới khác biệt nhau về ý định tìm kiếm (Search Intent) và sản phẩm trong hồ sơ thương hiệu. BẮT BUỘC trả về JSON {"topics": ["chủ đề 1", "chủ đề 2", "chủ đề 3"]}.',
        ].join("\n"),
      });

      suggestedSchedule = aiTopicsRes.data.topics.slice(0, 3).map((t, idx) => ({
        topic: t.trim(),
        daysFromNow: idx * 2 + 1,
      }));
    }

    for (const item of suggestedSchedule) {
      const plannedDate = new Date(
        Date.now() + item.daysFromNow * 24 * 60 * 60 * 1000
      );
      plannedDate.setHours(9, 0, 0, 0);

      const { data: inserted, error: insErr } = await supabase
        .from("articles")
        .insert({
          topic: item.topic,
          planned_publish_at: plannedDate.toISOString(),
        })
        .select("id")
        .single();

      if (insErr || !inserted) {
        throw new Error(insErr?.message ?? "Lỗi tạo bài trong lịch tự động");
      }

      createdCount++;
    }

    // Xử lý toàn bộ các job plan_outline trong hàng đợi để đảm bảo cả 3 bài đều chuyển sang outline_review (Cổng 1)
    for (let i = 0; i < 10; i++) {
      const jobRes = await processNextAgentJob();
      if (!jobRes.processed) break;
    }
  } catch (err) {
    errorMsg =
      err instanceof Error ? err.message : "Lỗi AI tự động lập lịch & ý chính";
  }

  revalidatePath("/admin/articles");
  if (errorMsg) {
    redirect("/admin/articles?error=" + encodeURIComponent(errorMsg));
  }
  redirect(
    "/admin/articles?notice=" +
    encodeURIComponent(
      `AI Agent đã tự động lập lịch 3 chủ đề MỚI (không trùng lặp — R-07) và tạo xong dàn ý + từ khóa riêng + FAQ! Bấm "Mở chi tiết →" để duyệt CỔNG 1.`
    )
  );
}

export async function runPendingWorkerJobAction(
  formData: FormData
): Promise<void> {
  const returnTo = String(formData.get("return_to") ?? "/admin/articles");
  let notice = "";
  let isErr = false;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect("/login");
    }

    let res = await processNextAgentJob();
    // Nếu hàng đợi trống mà đang bấm trên trang chi tiết 1 bài viết ở trạng thái chờ Agent -> tự enqueue lại và chạy ngay
    if (!res.processed && !isSupabaseConfigured()) {
      const match = returnTo.match(/\/admin\/articles\/([^/?]+)/);
      if (match) {
        const targetId = match[1];
        const st = getDemoState();
        const art = st.articles.find((a) => a.id === targetId);
        if (art) {
          const stepMap: Record<string, "plan_outline" | "analyze_images" | "write_article"> = {
            outline_draft: "plan_outline",
            analyzing_images: "analyze_images",
            writing: "write_article",
          };
          const step = stepMap[art.status];
          if (step) {
            st.queue.push({
              msg_id: st.nextMsgId++,
              message: { step, article_id: art.id, version: art.version },
              read_ct: 0,
              archived: false,
            });
            res = await processNextAgentJob();
          }
        }
      }
    }
    notice = res.detail;
  } catch (err) {
    isErr = true;
    notice = err instanceof Error ? err.message : "Lỗi chạy worker";
  }

  revalidatePath(returnTo);
  revalidatePath("/admin/articles");
  const sep = returnTo.includes("?") ? "&" : "?";
  redirect(
    `${returnTo}${sep}${isErr ? "error" : "notice"}=${encodeURIComponent(notice)}`
  );
}

export async function triggerPublishDueAction(
  formData: FormData
): Promise<void> {
  const returnTo = String(formData.get("return_to") ?? "/admin/articles");
  let notice = "";
  let isErr = false;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect("/login");
    }

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("publish_due_articles");
    if (error) {
      throw new Error(error.message);
    }
    const count = Number(data ?? 0);
    revalidatePath("/blog");
    notice = `Đã chạy publish_due_articles(): ${count} bài đến hạn được chuyển sang published.`;
  } catch (err) {
    isErr = true;
    notice = err instanceof Error ? err.message : "Lỗi gọi publish_due_articles";
  }

  revalidatePath(returnTo);
  revalidatePath("/admin/articles");
  const sep = returnTo.includes("?") ? "&" : "?";
  redirect(
    `${returnTo}${sep}${isErr ? "error" : "notice"}=${encodeURIComponent(notice)}`
  );
}
