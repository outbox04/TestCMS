import crypto from "node:crypto";
import sharp from "sharp";
import { CHECK_CONFIG } from "@/lib/checks/config";
import type { BrandProfileRow, ImageAnalysis } from "@/lib/supabase/types";

export interface ProcessedImageResult {
  sha256: string;
  originalWidth: number;
  originalHeight: number;
  analysisJpegBuffer: Buffer;
  analysisWidth: number;
  analysisHeight: number;
}

/**
 * Tính mã băm SHA-256 của buffer ảnh gốc để chống trùng lặp và làm khóa cache phân tích (R-13).
 */
export function computeImageSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Xử lý ảnh upload bằng sharp:
 * - Tính sha256 của ảnh gốc (R-13)
 * - Tạo bản phân tích JPEG có cạnh dài <= IMAGE_MAX_EDGE (mặc định 1568px, R-10, R-11)
 */
export async function processImageForAnalysis(
  inputBuffer: Buffer,
  maxEdge: number = CHECK_CONFIG.IMAGE_MAX_EDGE
): Promise<ProcessedImageResult> {
  const sha256 = computeImageSha256(inputBuffer);
  const metadata = await sharp(inputBuffer).metadata();
  const originalWidth = metadata.width ?? 0;
  const originalHeight = metadata.height ?? 0;

  if (!originalWidth || !originalHeight) {
    throw new Error("Không đọc được kích thước ảnh đầu vào");
  }

  const resizedPipeline = sharp(inputBuffer)
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: CHECK_CONFIG.IMAGE_JPEG_QUALITY, mozjpeg: true });

  const { data: analysisJpegBuffer, info } = await resizedPipeline.toBuffer({
    resolveWithObject: true,
  });

  return {
    sha256,
    originalWidth,
    originalHeight,
    analysisJpegBuffer,
    analysisWidth: info.width,
    analysisHeight: info.height,
  };
}

/**
 * Kiểm tra chống bịa tên thương hiệu / sản phẩm khi phân tích ảnh (R-17):
 * CẤM gán tên thương hiệu hoặc tên sản phẩm vào description / alt_text
 * nếu không thực sự nhìn thấy trong visible_text của ảnh.
 */
export function sanitizeAndValidateImageAnalysis(
  analysis: ImageAnalysis,
  brand: Pick<BrandProfileRow, "brand_name" | "products">
): ImageAnalysis {
  const visibleLower = (analysis.visible_text ?? "").toLowerCase();
  const candidateNames: string[] = [];

  if (brand.brand_name?.trim()) {
    candidateNames.push(brand.brand_name.trim());
  }
  for (const prod of brand.products ?? []) {
    if (prod.name?.trim()) {
      candidateNames.push(prod.name.trim());
    }
  }

  let description = analysis.description.trim();
  let altText = analysis.alt_text.trim();

  for (const name of candidateNames) {
    const nameLower = name.toLowerCase();
    if (!visibleLower.includes(nameLower)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");
      description = description.replace(regex, "thiết bị").replace(/\s+/g, " ").trim();
      altText = altText.replace(regex, "thiết bị").replace(/\s+/g, " ").trim();
    }
  }

  // Giới hạn description <= 40 từ (R-12) và alt_text <= 125 ký tự (R-17)
  const descWords = description.split(/\s+/).filter(Boolean);
  if (descWords.length > CHECK_CONFIG.IMAGE_DESCRIPTION_MAX_WORDS) {
    description = descWords
      .slice(0, CHECK_CONFIG.IMAGE_DESCRIPTION_MAX_WORDS)
      .join(" ");
  }

  if (altText.length > CHECK_CONFIG.IMAGE_ALT_MAX_CHARS) {
    altText = altText.slice(0, CHECK_CONFIG.IMAGE_ALT_MAX_CHARS).trim();
  }

  if (!altText) {
    altText = "Hình ảnh minh họa thực tế";
  }

  return {
    description,
    alt_text: altText,
    subjects: analysis.subjects,
    visible_text: analysis.visible_text,
  };
}

