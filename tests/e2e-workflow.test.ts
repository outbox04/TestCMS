import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { processNextAgentJob } from "@/lib/agent/worker";
import { CHECK_CONFIG } from "@/lib/checks/config";
import { processImageForAnalysis } from "@/lib/images/processor";
import {
  createLocalDemoSupabaseClient,
  getDemoState,
  resetDemoState,
} from "@/lib/supabase/local-demo-store";
import type { ArticleRow } from "@/lib/supabase/types";

describe("tests/e2e-workflow.test.ts — Kiểm thử toàn diện Kịch bản A, B, C, E, F trên luồng thực tế", () => {
  beforeEach(() => {
    const state = resetDemoState();
    state.vaultApiKey = "LOCAL_DEMO_MODE_KEY";
  });

  it("Khởi tạo sẵn 4 bài mẫu ở đủ các trạng thái (published, preview_review, outline_review, writing bẫy chống bịa)", () => {
    const state = getDemoState();
    expect(state.articles).toHaveLength(4);
    expect(state.articles[0].status).toBe("published");
    expect(state.articles[0].checks_passed).toBe(true);
    expect(state.articles[1].status).toBe("preview_review");
    expect(state.articles[1].checks_passed).toBe(true);
    expect(state.articles[2].status).toBe("outline_review");
    expect(state.articles[3].status).toBe("writing");
    expect(state.articles[3].checks_passed).toBe(false);
  });

  it("Kịch bản A & F: Chạy trọn vẹn 5 bước qua 2 cổng duyệt + resize ảnh 2400px + cache sha256 -> published", async () => {
    const editorClient = createLocalDemoSupabaseClient(false);

    // Bước 1: Tạo bài mới -> tự động enqueue plan_outline
    const { data: createdData, error: createErr } = await editorClient
      .from("articles")
      .insert({
        topic: "Cách pha cà phê espresso với máy LumiBrew Mini X1",
        planned_publish_at: new Date(Date.now() + 86400000).toISOString(),
      })
      .select("id")
      .single();

    expect(createErr).toBeNull();
    const created = createdData as ArticleRow;
    expect(created.status).toBe("outline_draft");

    // Worker chạy plan_outline -> chuyển sang CỔNG 1 (outline_review)
    const job1 = await processNextAgentJob();
    expect(job1.processed).toBe(true);
    expect(job1.step).toBe("plan_outline");

    const { data: afterPlanData } = await editorClient
      .from("articles")
      .select("*")
      .eq("id", created.id)
      .single();
    const afterPlan = afterPlanData as ArticleRow;
    expect(afterPlan.status).toBe("outline_review");
    expect(afterPlan.primary_keyword).toBe("LumiBrew Mini X1");

    // CỔNG 1: Nhân viên duyệt ý chính -> awaiting_images
    const { error: gate1Err } = await editorClient.rpc("transition_article", {
      p_article_id: afterPlan.id,
      p_to: "awaiting_images",
      p_expected_version: afterPlan.version,
      p_actor_kind: "editor",
      p_note: "Duyệt Cổng 1",
    });
    expect(gate1Err).toBeNull();

    // Bước 2: Tải ảnh 2400x1600px -> sharp resize <= 1568px JPEG
    const samplePng = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        background: { r: 200, g: 210, b: 220 },
      },
    })
      .png()
      .toBuffer();

    const processedImg = await processImageForAnalysis(
      samplePng,
      CHECK_CONFIG.IMAGE_MAX_EDGE
    );
    expect(processedImg.analysisWidth).toBeLessThanOrEqual(
      CHECK_CONFIG.IMAGE_MAX_EDGE
    );

    const origPath = `${afterPlan.id}/orig.png`;
    const analysisPath = `${afterPlan.id}/analysis.jpg`;
    await editorClient.storage
      .from("article-images")
      .upload(origPath, samplePng);
    await editorClient.storage
      .from("article-images")
      .upload(analysisPath, processedImg.analysisJpegBuffer);

    await editorClient.from("article_assets").insert({
      article_id: afterPlan.id,
      storage_path: origPath,
      analysis_path: analysisPath,
      sha256: processedImg.sha256,
      width: processedImg.originalWidth,
      height: processedImg.originalHeight,
    });

    // Nhân viên bấm "Xong ảnh, phân tích" -> analyzing_images
    const { error: toAnalyzeErr } = await editorClient.rpc(
      "transition_article",
      {
        p_article_id: afterPlan.id,
        p_to: "analyzing_images",
        p_expected_version: afterPlan.version + 1,
        p_actor_kind: "editor",
      }
    );
    expect(toAnalyzeErr).toBeNull();

    // Bước 3: Worker chạy analyze_images -> chuyển sang writing
    const job2 = await processNextAgentJob();
    expect(job2.processed).toBe(true);
    expect(job2.step).toBe("analyze_images");

    // Bước 4: Worker chạy write_article + 6 checks -> chuyển sang CỔNG 2 (preview_review)
    const job3 = await processNextAgentJob();
    expect(job3.processed).toBe(true);
    expect(job3.step).toBe("write_article");

    const { data: atGate2Data } = await editorClient
      .from("articles")
      .select("*")
      .eq("id", created.id)
      .single();
    const atGate2 = atGate2Data as ArticleRow;
    expect(atGate2.status).toBe("preview_review");
    expect(atGate2.checks_passed).toBe(true);
    expect(atGate2.check_report?.passed).toBe(true);

    // CỔNG 2: Nhân viên bấm "Đăng ngay" -> published
    const { error: gate2Err } = await editorClient.rpc("transition_article", {
      p_article_id: atGate2.id,
      p_to: "published",
      p_expected_version: atGate2.version,
      p_actor_kind: "editor",
      p_note: "Đăng ngay tại Cổng 2",
    });
    expect(gate2Err).toBeNull();

    const { data: finalArtData } = await editorClient
      .from("articles")
      .select("*")
      .eq("id", created.id)
      .single();
    expect((finalArtData as ArticleRow).status).toBe("published");
  });

  it("Kịch bản B & E: Lên lịch đăng (scheduled -> publish_due_articles) và chặn sửa status trái phép / chặn Agent tự đăng", async () => {
    const editorClient = createLocalDemoSupabaseClient(false);
    const agentClient = createLocalDemoSupabaseClient(true);
    const state = getDemoState();

    // Bài #2 đang ở preview_review (v7)
    const art2 = state.articles.find((a) => a.status === "preview_review")!;
    expect(art2).toBeDefined();

    // Kịch bản E1: Editor tự UPDATE cột status trực tiếp -> bị từ chối
    const { error: directUpdateErr } = await editorClient
      .from("articles")
      .update({ status: "published" })
      .eq("id", art2.id);
    expect(directUpdateErr).not.toBeNull();
    expect(directUpdateErr?.message).toContain("transition_article()");

    // Kịch bản E2: Agent cố tình chuyển sang published hoặc scheduled -> bị từ chối
    const { error: agentPublishErr } = await agentClient.rpc(
      "transition_article",
      {
        p_article_id: art2.id,
        p_to: "published",
        p_expected_version: art2.version,
        p_actor_kind: "agent",
      }
    );
    expect(agentPublishErr).not.toBeNull();
    expect(agentPublishErr?.message).toContain("Không được chuyển");

    // Kịch bản B: Editor lên lịch ở tương lai (+5 giây) -> scheduled
    const futureIso = new Date(Date.now() + 5000).toISOString();
    await editorClient
      .from("articles")
      .update({ scheduled_at: futureIso })
      .eq("id", art2.id);

    const { error: schedErr } = await editorClient.rpc("transition_article", {
      p_article_id: art2.id,
      p_to: "scheduled",
      p_expected_version: art2.version,
      p_actor_kind: "editor",
    });
    expect(schedErr).toBeNull();
    expect(art2.status).toBe("scheduled");

    // Đặt thời điểm scheduled_at về quá khứ 1 giây rồi gọi publish_due_articles()
    art2.scheduled_at = new Date(Date.now() - 1000).toISOString();
    const { data: pubCount, error: pubDueErr } = await agentClient.rpc(
      "publish_due_articles"
    );
    expect(pubDueErr).toBeNull();
    expect(pubCount).toBe(1);
    expect(art2.status).toBe("published");
  });
});

