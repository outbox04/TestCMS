import crypto from "node:crypto";
import type { MuseCredentialPayload } from "./provider-types";

const ENCRYPTION_VERSION_PREFIX = "v1";
const IV_BYTE_LENGTH = 12; // 96-bit IV chuẩn cho AES-256-GCM
const AUTH_TAG_BYTE_LENGTH = 16;

const DEFAULT_DEV_FALLBACK_SEED =
  "content-seo-agent-v2-server-only-aes256gcm-fallback-seed";

/**
 * Lấy khóa 32 bytes (256-bit) cho AES-256-GCM từ biến môi trường phía server.
 * Ưu tiên AI_CREDENTIALS_ENCRYPTION_KEY -> SUPABASE_SERVICE_ROLE_KEY -> AGENT_WORKER_SECRET.
 */
function resolveAes256Key(): Buffer {
  const rawSecret =
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.AGENT_WORKER_SECRET?.trim() ||
    DEFAULT_DEV_FALLBACK_SEED;

  return crypto.createHash("sha256").update(rawSecret, "utf8").digest();
}

export function isDedicatedEncryptionKeyConfigured(): boolean {
  return Boolean(process.env.AI_CREDENTIALS_ENCRYPTION_KEY?.trim());
}

/**
 * Mã hóa thông tin xác thực (cookie / token) bằng AES-256-GCM.
 * Định dạng lưu trữ: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`
 */
export function encryptCredentialPayload(
  payload: MuseCredentialPayload
): string {
  const key = resolveAes256Key();
  const iv = crypto.randomBytes(IV_BYTE_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_BYTE_LENGTH,
  });

  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION_PREFIX,
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Giải mã chuỗi AES-256-GCM về đối tượng MuseCredentialPayload ở phía server.
 */
export function decryptCredentialPayload(
  encryptedString: string
): MuseCredentialPayload {
  const parts = encryptedString.trim().split(":");
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION_PREFIX) {
    throw new Error("Định dạng dữ liệu mã hóa không hợp lệ (AES-256-GCM)");
  }

  const [, ivB64, tagB64, cipherB64] = parts;
  const key = resolveAes256Key();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(cipherB64, "base64");

  if (
    iv.length !== IV_BYTE_LENGTH ||
    authTag.length !== AUTH_TAG_BYTE_LENGTH
  ) {
    throw new Error("Tham số IV hoặc AuthTag của AES-256-GCM bị hỏng");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_BYTE_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(decrypted) as MuseCredentialPayload;
}

/**
 * Xoay vòng mã hóa (Re-encrypt) với IV mới và cập nhật rotated_at.
 */
export function rotateEncryptedCredentials(
  existingEncrypted: string,
  newCredentialValue?: string
): string {
  const current = decryptCredentialPayload(existingEncrypted);
  const nextPayload: MuseCredentialPayload = {
    ...current,
    credential_value: newCredentialValue
      ? newCredentialValue.trim()
      : current.credential_value,
    rotated_at: new Date().toISOString(),
  };
  return encryptCredentialPayload(nextPayload);
}

/**
 * Lọc sạch mọi dấu vết cookie, session token, API key hoặc chuỗi mã hóa khỏi log/thông báo lỗi.
 */
export function redactSecretsFromLog(
  rawMessage: string,
  knownSecretValues: string[] = []
): string {
  let clean = rawMessage;

  for (const secret of knownSecretValues) {
    const trimmed = secret?.trim();
    if (trimmed && trimmed.length >= 4) {
      clean = clean.split(trimmed).join("[REDACTED_SECRET]");
    }
  }

  // Che các chuỗi định dạng AES-256-GCM v1:...:...:...
  clean = clean.replace(
    /\bv1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+\b/g,
    "[REDACTED_CIPHERTEXT]"
  );

  // Che các mẫu Cookie / Session / Token / API Key phổ biến
  clean = clean.replace(
    /(?:cookie|set-cookie|authorization|bearer|x-api-key|session_id|muse_session|token)\s*[:=]\s*[^\s,;'"&]+/gi,
    "[REDACTED_CREDENTIAL]"
  );
  clean = clean.replace(
    /\b(?:sk-[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{15,}|AQ\.[A-Za-z0-9_.-]{10,}|muse_[A-Za-z0-9_-]{8,})\b/g,
    "[REDACTED_KEY]"
  );

  return clean;
}

interface RateLimitBucket {
  count: number;
  windowStartMs: number;
}

const authRateLimitMap = new Map<string, RateLimitBucket>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 phút
const MAX_AUTH_ATTEMPTS_PER_WINDOW = 10;

/**
 * Giới hạn tần suất thử xác thực / kết nối để chống brute-force.
 */
export function checkAuthRateLimit(
  actorKey: string,
  maxAttempts: number = MAX_AUTH_ATTEMPTS_PER_WINDOW
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = authRateLimitMap.get(actorKey);

  if (!bucket || now - bucket.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
    authRateLimitMap.set(actorKey, { count: 1, windowStartMs: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= maxAttempts) {
    const retryAfterSeconds = Math.ceil(
      (RATE_LIMIT_WINDOW_MS - (now - bucket.windowStartMs)) / 1000
    );
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetAuthRateLimitsForTest(): void {
  authRateLimitMap.clear();
}

/**
 * Kiểm tra chống CSRF trên các API quản trị thay đổi trạng thái (POST/PUT/DELETE).
 */
export function verifyCsrfAndOrigin(request: Request): {
  valid: boolean;
  reason?: string;
} {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return {
          valid: false,
          reason: `Origin (${originHost}) không khớp với Host (${host}) — Chặn nghi vấn CSRF.`,
        };
      }
    } catch {
      return { valid: false, reason: "Header Origin không hợp lệ." };
    }
  }

  return { valid: true };
}

