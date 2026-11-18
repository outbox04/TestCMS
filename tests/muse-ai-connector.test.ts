import { beforeEach, describe, expect, it } from "vitest";
import { processNextAgentJob } from "@/lib/agent/worker";
import { executeSharedAiTask } from "@/lib/ai/ai-orchestrator";
import {
  connectOrUpdateMuseCredentials,
  disconnectMuseProvider,
  getMuseConnectionRowInternal,
  getMuseConnectionStatus,
  getMuseProviderLogs,
  verifyStoredMuseConnection,
} from "@/lib/ai/connector-manager";
import {
  decryptCredentialPayload,
  encryptCredentialPayload,
  redactSecretsFromLog,
  resetAuthRateLimitsForTest,
} from "@/lib/ai/secret-vault";
import {
  createLocalDemoSupabaseClient,
  getDemoState,
  resetDemoState,
} from "@/lib/supabase/local-demo-store";
import type { ArticleRow } from "@/lib/supabase/types";

describe("tests/muse-ai-connector.test.ts — Kiểm thử 14 kịch bản Giai đoạn 9: Muse AI Global Connector & Security Vault", () => {
  beforeEach(() => {
    const state = resetDemoState();
    state.vaultApiKey = "LOCAL_DEMO_MODE_KEY";
    resetAuthRateLimitsForTest();
  });

  const mockSuccessFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/session/verify")) {
      return new Response(JSON.stringify({ ok: true, account: "global" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/v1/completions")) {
      return new Response(
        JSON.stringify({
          output_text: "Nội dung nghiên cứu chuẩn từ tài khoản Muse AI dùng chung.",
          structured_data: { summary: "OK" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("Not Found", { status: 404 });
  };

  it("Kịch bản 1, 4, 5: Kết nối thành công, Cập nhật xoay vòng khóa AES-256-GCM và Ngắt kết nối xóa khóa", async () => {
    // 1. Kết nối thành công với endpoint chính thức
    const connectedStatus = await connectOrUpdateMuseCredentials({
      actorId: "admin-1",
      actorRole: "admin",
      authType: "api_token",
      credentialValue: "muse_live_secret_token_1234567890",
      endpointUrl: "https://api.muse.example.com",
      customFetch: mockSuccessFetch,
    });

    expect(connectedStatus.status).toBe("connected");
    expect(connectedStatus.has_saved_credentials).toBe(true);
    expect(connectedStatus.last_verified_at).not.toBeNull();

    const row1 = await getMuseConnectionRowInternal();
    expect(row1?.encrypted_credentials).toMatch(/^v1:/);
    expect(row1?.encrypted_credentials).not.toContain(
      "muse_live_secret_token_1234567890"
    );

    const decrypted1 = decryptCredentialPayload(row1!.encrypted_credentials!);
    expect(decrypted1.credential_value).toBe(
      "muse_live_secret_token_1234567890"
    );

    // 4. Cập nhật thông tin xác thực (xoay vòng IV AES-256-GCM)
    const updatedStatus = await connectOrUpdateMuseCredentials(
      {
        actorId: "admin-1",
        actorRole: "admin",
        authType: "api_token",
        credentialValue: "muse_rotated_token_9999999999",
        endpointUrl: "https://api.muse.example.com",
        customFetch: mockSuccessFetch,
      },
      "update"
    );
    expect(updatedStatus.status).toBe("connected");
    const row2 = await getMuseConnectionRowInternal();
    expect(row2?.encrypted_credentials).not.toBe(row1?.encrypted_credentials);
    const decrypted2 = decryptCredentialPayload(row2!.encrypted_credentials!);
    expect(decrypted2.credential_value).toBe("muse_rotated_token_9999999999");

    // 5. Ngắt kết nối (xóa hoàn toàn encrypted_credentials)
    const disconnectedStatus = await disconnectMuseProvider({
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(disconnectedStatus.status).toBe("disconnected");
    expect(disconnectedStatus.has_saved_credentials).toBe(false);
    const rowAfterDisconnect = await getMuseConnectionRowInternal();
    expect(rowAfterDisconnect?.encrypted_credentials).toBeNull();
  });

  it("Kịch bản 2 & 3: Thông tin xác thực không hợp lệ (401) và Phiên hết hạn (SESSION_EXPIRED)", async () => {
    const invalidFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
      });

    // 2. Thông tin xác thực không hợp lệ
    const badStatus = await connectOrUpdateMuseCredentials({
      actorId: "admin-1",
      actorRole: "admin",
      authType: "api_token",
      credentialValue: "muse_wrong_token_0000000000",
      endpointUrl: "https://api.muse.example.com",
      customFetch: invalidFetch,
    });
    expect(badStatus.status).toBe("error");
    expect(badStatus.error_code).toBe("INVALID_CREDENTIALS");

    // 3. Phiên hết hạn khi Verify lại
    const expiredFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "Session expired" }), {
        status: 401,
        headers: { "x-session-expired": "true" },
      });

    const expiredStatus = await verifyStoredMuseConnection({
      actorId: "admin-1",
      actorRole: "admin",
      customFetch: expiredFetch,
    });
    expect(expiredStatus.status).toBe("expired");
    expect(expiredStatus.error_code).toBe("SESSION_EXPIRED");
  });

  it("Kịch bản 6: Nhân viên (editor) bị chặn quyền quản lý kết nối (FORBIDDEN_NOT_ADMIN)", async () => {
    await expect(
      connectOrUpdateMuseCredentials({
        actorId: "editor-1",
        actorRole: "editor",
        authType: "api_token",
        credentialValue: "muse_token_1234567890",
        endpointUrl: "https://api.muse.example.com",
      })
    ).rejects.toThrow(/Chỉ quản trị viên/);

    await expect(
      disconnectMuseProvider({
        actorId: "editor-1",
        actorRole: "editor",
      })
    ).rejects.toThrow(/Chỉ quản trị viên/);
  });

  it("Kịch bản 7 & 8: Nhiều nhân viên (editor) dùng chung 1 tài khoản Muse AI Global và chặn tác vụ trùng idempotency_key đồng thời", async () => {
    await connectOrUpdateMuseCredentials({
      actorId: "admin-1",
      actorRole: "admin",
      authType: "api_token",
      credentialValue: "muse_shared_global_token_abc12345",
      endpointUrl: "https://api.muse.example.com",
      customFetch: mockSuccessFetch,
    });

    // 7. Hai nhân viên editor-1 và editor-2 cùng gọi song song với idempotency_key khác nhau -> cả 2 đều thành công
    const [res1, res2] = await Promise.all([
      executeSharedAiTask({
        actorId: "editor-1",
        actorRole: "editor",
        task: {
          task_type: "research",
          prompt: "Nghiên cứu chủ đề máy pha cà phê",
          idempotency_key: "task-editor-1",
        },
        customFetch: mockSuccessFetch,
      }),
      executeSharedAiTask({
        actorId: "editor-2",
        actorRole: "editor",
        task: {
          task_type: "plan_outline",
          prompt: "Lập dàn ý máy xay cà phê",
          idempotency_key: "task-editor-2",
        },
        customFetch: mockSuccessFetch,
      }),
    ]);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res1.provider_used).toBe("muse");
    expect(res2.provider_used).toBe("muse");

    // 8. Hai tác vụ chạy đồng thời trùng cùng 1 idempotency_key -> chặn tạo tác vụ trùng lặp
    const slowFetch: typeof fetch = async () => {
      await new Promise((r) => setTimeout(r, 40));
      return new Response(JSON.stringify({ output_text: "Done" }), {
        status: 200,
      });
    };

    const p1 = executeSharedAiTask({
      actorId: "editor-1",
      actorRole: "editor",
      task: {
        task_type: "write_article",
        prompt: "Viết bài",
        idempotency_key: "same-job-key-001",
      },
      customFetch: slowFetch,
    });

    await expect(
      executeSharedAiTask({
        actorId: "editor-2",
        actorRole: "editor",
        task: {
          task_type: "write_article",
          prompt: "Viết bài trùng",
          idempotency_key: "same-job-key-001",
        },
        customFetch: slowFetch,
      })
    ).rejects.toThrow(/đang được thực thi/);

    const p1Result = await p1;
    expect(p1Result.ok).toBe(true);
  });

  it("Kịch bản 9 & 10: Xử lý AI Provider không phản hồi (Timeout) và Chặn Cookie khi chính sách chưa cho phép (Không báo Connected giả)", async () => {
    // 10. Thử kết nối bằng Cookie khi MUSE_AI_ALLOW_COOKIE_AUTH chưa bật -> status='unsupported', KHÔNG báo connected
    const cookieStatus = await connectOrUpdateMuseCredentials({
      actorId: "admin-1",
      actorRole: "admin",
      authType: "cookie",
      credentialValue: "muse_session=secret_cookie_val_123456",
    });
    expect(cookieStatus.status).toBe("unsupported");
    expect(cookieStatus.error_code).toBe(
      "COOKIE_AUTH_NOT_SUPPORTED_BY_POLICY"
    );

    // 9. Khi Provider bị treo (Timeout / Abort)
    const timeoutFetch: typeof fetch = async (_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("The operation was aborted due to timeout"));
        });
      });
    };

    const timeoutStatus = await connectOrUpdateMuseCredentials({
      actorId: "admin-1",
      actorRole: "admin",
      authType: "api_token",
      credentialValue: "muse_valid_token_for_timeout_test",
      endpointUrl: "https://api.muse.example.com",
      customFetch: (input) => timeoutFetch(input, { signal: AbortSignal.timeout(15) }),
    });
    expect(timeoutStatus.status).toBe("error");
    expect(timeoutStatus.error_code).toBe("PROVIDER_TIMEOUT");
  });

  it("Kịch bản 11 & 12: Tuyệt đối không rò rỉ thông tin xác thực qua Frontend Status API hoặc trong Logs", async () => {
    const secretVal = "muse_super_secret_token_xyz987654321";
    const encrypted = encryptCredentialPayload({
      auth_type: "api_token",
      credential_value: secretVal,
      rotated_at: new Date().toISOString(),
    });

    await connectOrUpdateMuseCredentials({
      actorId: "admin-1",
      actorRole: "admin",
      authType: "api_token",
      credentialValue: secretVal,
      endpointUrl: "https://api.muse.example.com",
      customFetch: async () => {
        throw new Error(
          `Connection failed for Authorization: Bearer ${secretVal} with payload ${encrypted}`
        );
      },
    });

    // 11. Kiểm tra đối tượng status trả về cho frontend không chứa secret hay ciphertext
    const publicStatus = await getMuseConnectionStatus();
    const serializedStatus = JSON.stringify(publicStatus);
    expect(serializedStatus).not.toContain(secretVal);
    expect(serializedStatus).not.toContain("v1:");
    expect("encrypted_credentials" in publicStatus).toBe(false);

    // 12. Kiểm tra bảng logs và hàm redactSecretsFromLog không chứa secret
    const logs = await getMuseProviderLogs(10);
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(secretVal);
    expect(serializedLogs).not.toContain("v1:");

    const redacted = redactSecretsFromLog(
      `Cookie: muse_session=${secretVal}; key=${ encrypted }`,
      [secretVal]
    );
    expect(redacted).not.toContain(secretVal);
    expect(redacted).not.toContain("v1:");
  });

  it("Kịch bản 13 & 14: Quy trình Content Agent, 2 cổng duyệt và xuất bản vẫn hoạt động nguyên vẹn", async () => {
    const editorClient = createLocalDemoSupabaseClient(false);
    const state = getDemoState();

    // Bài viết mẫu #3 đang ở Cổng 1 (outline_review)
    const art3 = state.articles.find((a) => a.status === "outline_review")!;
    expect(art3).toBeDefined();

    // Agent bị chặn tự chuyển sang published (Cổng 2 vẫn khóa chặt)
    const agentClient = createLocalDemoSupabaseClient(true);
    const { error: agentPubErr } = await agentClient.rpc("transition_article", {
      p_article_id: art3.id,
      p_to: "published",
      p_expected_version: art3.version,
      p_actor_kind: "agent",
    });
    expect(agentPubErr).not.toBeNull();

    // Tạo bài mới và chạy Worker plan_outline -> vẫn đưa về Cổng 1 (outline_review) bình thường
    const { data: created } = await editorClient
      .from("articles")
      .insert({
        topic: "Hướng dẫn pha espresso với máy LumiBrew Mini X1",
      })
      .select("id")
      .single();

    const jobRes = await processNextAgentJob();
    expect(jobRes.processed).toBe(true);
    expect(jobRes.step).toBe("plan_outline");

    const { data: updatedArt } = await editorClient
      .from("articles")
      .select("*")
      .eq("id", (created as ArticleRow).id)
      .single();
    expect((updatedArt as ArticleRow).status).toBe("outline_review");
  });
});

