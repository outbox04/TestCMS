"use client";

import { useState } from "react";
import type {
  AiAuthType,
  AiProviderLogRow,
  SafeProviderConnectionStatus,
} from "@/lib/ai/provider-types";

export interface MuseAiConnectorCardProps {
  initialStatus: SafeProviderConnectionStatus;
  initialLogs: AiProviderLogRow[];
}

const STATUS_BADGE_MAP: Record<
  SafeProviderConnectionStatus["status"],
  { label: string; className: string }
> = {
  connected: {
    label: "● CONNECTED (Đã xác minh)",
    className:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  disconnected: {
    label: "○ DISCONNECTED (Chưa kết nối)",
    className: "border-slate-600 bg-slate-800/80 text-slate-300",
  },
  expired: {
    label: "▲ SESSION EXPIRED (Hết hạn phiên)",
    className: "border-amber-500/50 bg-amber-500/15 text-amber-300",
  },
  error: {
    label: "✕ CONNECTION ERROR (Lỗi xác thực)",
    className: "border-red-500/50 bg-red-500/15 text-red-300",
  },
  unsupported: {
    label: "◆ UNSUPPORTED / PENDING OFFICIAL ENDPOINT",
    className: "border-amber-400/50 bg-amber-500/10 text-amber-200",
  },
};

export function MuseAiConnectorCard({
  initialStatus,
  initialLogs,
}: MuseAiConnectorCardProps) {
  const [status, setStatus] =
    useState<SafeProviderConnectionStatus>(initialStatus);
  const [logs, setLogs] = useState<AiProviderLogRow[]>(initialLogs);
  const [authType, setAuthType] = useState<AiAuthType>(
    initialStatus.auth_type ?? "api_token"
  );
  const [credentialInput, setCredentialInput] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  async function refreshStatusAndLogs() {
    const res = await fetch("/api/admin/ai/muse/status", {
      method: "GET",
      cache: "no-store",
    });
    if (res.ok) {
      const payload = (await res.json()) as {
        status: SafeProviderConnectionStatus;
        logs: AiProviderLogRow[];
      };
      setStatus(payload.status);
      setLogs(payload.logs);
    }
  }

  async function handleConnect() {
    if (!credentialInput.trim()) {
      setFeedback({
        kind: "error",
        text: "Vui lòng nhập thông tin xác thực trước khi bấm Kết nối.",
      });
      return;
    }

    setLoadingAction("connect");
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ai/muse/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_type: authType,
          credential_value: credentialInput,
        }),
      });
      const payload = (await res.json()) as {
        status?: SafeProviderConnectionStatus;
        error?: string;
      };
      // Xóa ngay ô nhập trên trình duyệt sau khi gửi để không lưu lại trên DOM
      setCredentialInput("");

      if (!res.ok || payload.error) {
        setFeedback({
          kind: "error",
          text: payload.error ?? "Không thể kết nối Muse AI.",
        });
      } else if (payload.status) {
        setStatus(payload.status);
        setFeedback({
          kind: payload.status.status === "connected" ? "success" : "error",
          text:
            payload.status.status === "connected"
              ? "Đã mã hóa AES-256-GCM và kết nối thành công tài khoản Muse AI dùng chung!"
              : (payload.status.error_message ??
                `Trạng thái xác minh: ${payload.status.status}`),
        });
      }
      await refreshStatusAndLogs();
    } catch {
      setFeedback({
        kind: "error",
        text: "Lỗi mạng khi gửi yêu cầu kết nối Muse AI.",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleUpdateCredentials() {
    if (!credentialInput.trim()) {
      setFeedback({
        kind: "error",
        text: "Vui lòng nhập thông tin xác thực mới để cập nhật & xoay vòng khóa AES-256-GCM.",
      });
      return;
    }

    setLoadingAction("update");
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ai/muse/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_type: authType,
          credential_value: credentialInput,
        }),
      });
      const payload = (await res.json()) as {
        status?: SafeProviderConnectionStatus;
        error?: string;
      };
      setCredentialInput("");

      if (!res.ok || payload.error) {
        setFeedback({
          kind: "error",
          text: payload.error ?? "Cập nhật thông tin xác thực thất bại.",
        });
      } else if (payload.status) {
        setStatus(payload.status);
        setFeedback({
          kind: payload.status.status === "connected" ? "success" : "error",
          text:
            payload.status.status === "connected"
              ? "Đã cập nhật thông tin xác thực (xoay vòng IV AES-256-GCM) và xác minh thành công!"
              : (payload.status.error_message ??
                `Đã lưu mã hóa nhưng chưa đạt xác minh (${payload.status.status}).`),
        });
      }
      await refreshStatusAndLogs();
    } catch {
      setFeedback({
        kind: "error",
        text: "Lỗi mạng khi cập nhật thông tin xác thực.",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleVerify() {
    setLoadingAction("verify");
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ai/muse/verify", {
        method: "POST",
      });
      const payload = (await res.json()) as {
        status?: SafeProviderConnectionStatus;
        error?: string;
      };

      if (!res.ok || payload.error) {
        setFeedback({
          kind: "error",
          text: payload.error ?? "Kiểm tra kết nối thất bại.",
        });
      } else if (payload.status) {
        setStatus(payload.status);
        setFeedback({
          kind: payload.status.status === "connected" ? "success" : "error",
          text:
            payload.status.status === "connected"
              ? "Xác minh kết nối Muse AI thành công!"
              : (payload.status.error_message ??
                `Kết nối chưa sẵn sàng (${payload.status.status}).`),
        });
      }
      await refreshStatusAndLogs();
    } catch {
      setFeedback({
        kind: "error",
        text: "Lỗi mạng khi xác minh kết nối.",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleDisconnect() {
    setLoadingAction("disconnect");
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ai/muse/disconnect", {
        method: "POST",
      });
      const payload = (await res.json()) as {
        status?: SafeProviderConnectionStatus;
        error?: string;
      };

      if (!res.ok || payload.error) {
        setFeedback({
          kind: "error",
          text: payload.error ?? "Ngắt kết nối thất bại.",
        });
      } else if (payload.status) {
        setStatus(payload.status);
        setCredentialInput("");
        setFeedback({
          kind: "success",
          text: "Đã thu hồi và xóa hoàn toàn thông tin xác thực Muse AI khỏi cơ sở dữ liệu.",
        });
      }
      await refreshStatusAndLogs();
    } catch {
      setFeedback({
        kind: "error",
        text: "Lỗi mạng khi ngắt kết nối.",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  const badge = STATUS_BADGE_MAP[status.status] ?? STATUS_BADGE_MAP.disconnected;
  const errorLogs = logs.filter((l) => l.status === "failed");

  return (
    <div className="space-y-6">
      {/* Card chính phong cách Dark Luxury */}
      <section className="rounded-xl border border-amber-500/30 bg-slate-950 p-6 text-slate-100 shadow-xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="text-xs font-semibold uppercase tracking-widest text-amber-400">
                Global AI Provider Connector · AES-256-GCM Vault
              </span>
            </div>
            <h2 className="text-xl font-bold text-white mt-1">
              1. Provider Name: {status.provider_name}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Phạm vi: <code className="text-amber-300">GLOBAL</code> (Một tài
              khoản dùng chung cho toàn bộ nhân viên được cấp quyền trong CMS —
              chỉ Admin được quản lý kết nối).
            </p>
          </div>

          {/* 2. Connection Status */}
          <div className="flex flex-col items-end gap-1.5">
            <span
              className={`rounded-full border px-3.5 py-1 text-xs font-semibold ${badge.className}`}
            >
              {badge.label}
            </span>
            <span className="text-[11px] text-slate-400">
              Dữ liệu mã hóa trong Vault:{" "}
              <strong className="text-slate-200">
                {status.has_saved_credentials
                  ? "Đã lưu (Ẩn tuyệt đối)"
                  : "Trống"}
              </strong>
            </span>
          </div>
        </div>

        {/* Cảnh báo tương thích / Chính sách Cookie chính thức */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200 space-y-1.5">
          <div className="font-bold text-amber-300">
            🛡️ Kiểm tra tương thích & Chính sách tích hợp chính thức:
          </div>
          <div>{status.compatibility.notice}</div>
          <div className="text-amber-300/80">
            • Phương thức khuyến nghị:{" "}
            <strong>OAuth / Official API Token</strong>. Chỉ sử dụng Cookie khi
            điều khoản chính thức của Muse AI cho phép (
            <code>MUSE_AI_ALLOW_COOKIE_AUTH=true</code>) và đã cấu hình{" "}
            <code>MUSE_AI_API_BASE_URL</code>. Hệ thống không tự suy đoán
            endpoint nội bộ và không hiển thị <code>Connected</code> nếu chưa
            xác minh thực tế.
          </div>
        </div>

        {/* Thông báo phản hồi thao tác */}
        {feedback ? (
          <div
            role="alert"
            className={`rounded-lg border p-3.5 text-xs ${
              feedback.kind === "success"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-red-500/40 bg-red-500/10 text-red-200"
            }`}
          >
            {feedback.text}
          </div>
        ) : null}

        {/* 8. Last Verified, 9. Last Used, 10. Error Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              8. Lần xác minh cuối (`last_verified_at`)
            </div>
            <div className="text-sm font-semibold text-slate-100 mt-1">
              {status.last_verified_at
                ? new Date(status.last_verified_at).toLocaleString("vi-VN")
                : "Chưa xác minh"}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              9. Lần sử dụng cuối (`last_used_at`)
            </div>
            <div className="text-sm font-semibold text-slate-100 mt-1">
              {status.last_used_at
                ? new Date(status.last_used_at).toLocaleString("vi-VN")
                : "Chưa sử dụng"}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              10. Chi tiết lỗi (`error_details`)
            </div>
            <div className="text-xs font-medium text-red-300 mt-1 line-clamp-2">
              {status.error_code
                ? `[${status.error_code}] ${status.error_message ?? ""}`
                : "Không có lỗi"}
            </div>
          </div>
        </div>

        {/* 3. Credential Input */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="muse_auth_type"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                Phương thức xác thực (`auth_type`)
              </label>
              <select
                id="muse_auth_type"
                value={authType}
                onChange={(e) => setAuthType(e.target.value as AiAuthType)}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
              >
                <option value="api_token">
                  Official API Token (Khuyến nghị)
                </option>
                <option value="oauth">Official OAuth Bearer Token</option>
                <option value="cookie">
                  Session Cookie (Chỉ dùng khi Muse AI cho phép)
                </option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="muse_credential_input"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                3. Thông tin xác thực (`Credential Input` — Mã hóa AES-256-GCM,
                không hiển thị lại sau khi lưu)
              </label>
              <input
                id="muse_credential_input"
                type="password"
                autoComplete="off"
                value={credentialInput}
                onChange={(e) => setCredentialInput(e.target.value)}
                placeholder={
                  authType === "cookie"
                    ? "Nhập chuỗi Cookie được hỗ trợ (ví dụ: muse_session=...)..."
                    : "Nhập API Token hoặc OAuth Token chính thức của Muse AI..."
                }
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* 4. Connect, 5. Verify Connection, 6. Update Credentials, 7. Disconnect */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={handleConnect}
              disabled={loadingAction !== null}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {loadingAction === "connect"
                ? "Đang kết nối..."
                : "4. Connect (Kết nối mới)"}
            </button>

            <button
              type="button"
              onClick={handleVerify}
              disabled={
                loadingAction !== null || !status.has_saved_credentials
              }
              className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
            >
              {loadingAction === "verify"
                ? "Đang kiểm tra..."
                : "5. Verify Connection (Kiểm tra kết nối)"}
            </button>

            <button
              type="button"
              onClick={handleUpdateCredentials}
              disabled={loadingAction !== null}
              className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              {loadingAction === "update"
                ? "Đang cập nhật..."
                : "6. Update Credentials (Cập nhật & Xoay vòng khóa)"}
            </button>

            <button
              type="button"
              onClick={handleDisconnect}
              disabled={
                loadingAction !== null ||
                (!status.has_saved_credentials &&
                  status.status === "disconnected")
              }
              className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-40"
            >
              {loadingAction === "disconnect"
                ? "Đang ngắt kết nối..."
                : "7. Disconnect (Ngắt kết nối & Xóa khóa)"}
            </button>
          </div>
        </div>
      </section>

      {/* Lịch sử sử dụng & Lịch sử lỗi (ai_provider_logs) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">
            📊 Lịch sử sử dụng Muse AI (`ai_provider_logs` — {logs.length} bản
            ghi)
          </h3>
          {logs.length === 0 ? (
            <p className="text-xs text-slate-500">
              Chưa có lịch sử hoạt động nào của Muse AI.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="py-2 pr-2">Thời gian</th>
                    <th className="py-2 pr-2">Tác vụ (`task_type`)</th>
                    <th className="py-2 pr-2">Trạng thái</th>
                    <th className="py-2 pr-2">Độ trễ</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-slate-100">
                      <td className="py-2 pr-2 text-slate-600">
                        {new Date(log.created_at).toLocaleTimeString("vi-VN")}
                      </td>
                      <td className="py-2 pr-2 font-mono text-slate-900">
                        {log.task_type}
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className={
                            log.status === "completed"
                              ? "text-emerald-700 font-semibold"
                              : "text-red-700 font-semibold"
                          }
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-slate-600">
                        {log.duration_ms}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">
            ⚠️ Lịch sử lỗi xác thực & kết nối ({errorLogs.length} lỗi)
          </h3>
          {errorLogs.length === 0 ? (
            <p className="text-xs text-slate-500">
              Không có lỗi nào được ghi nhận.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="py-2 pr-2">Thời gian</th>
                    <th className="py-2 pr-2">Tác vụ</th>
                    <th className="py-2 pr-2">Mã lỗi (`error_code`)</th>
                  </tr>
                </thead>
                <tbody>
                  {errorLogs.map((errLog) => (
                    <tr key={errLog.id} className="border-b border-slate-100">
                      <td className="py-2 pr-2 text-slate-600">
                        {new Date(errLog.created_at).toLocaleTimeString("vi-VN")}
                      </td>
                      <td className="py-2 pr-2 font-mono text-slate-900">
                        {errLog.task_type}
                      </td>
                      <td className="py-2 pr-2 font-mono text-red-700">
                        {errLog.error_code ?? "UNKNOWN_ERROR"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

