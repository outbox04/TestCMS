import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CHECK_CONFIG } from "@/lib/checks/config";
import {
  processImageForAnalysis,
  sanitizeAndValidateImageAnalysis,
} from "@/lib/images/processor";

describe("lib/images/processor.ts — Resize ảnh bằng sharp, sha256 và chống bịa tên thương hiệu", () => {
  it("Ảnh lớn 4000x3000px được resize về cạnh dài <= 1568px JPEG và trả cùng sha256 cho cùng ảnh (Kịch bản F)", async () => {
    const largePngBuffer = await sharp({
      create: {
        width: 4000,
        height: 3000,
        channels: 3,
        background: { r: 220, g: 230, b: 240 },
      },
    })
      .png()
      .toBuffer();

    const firstRun = await processImageForAnalysis(largePngBuffer);
    const secondRun = await processImageForAnalysis(largePngBuffer);

    expect(firstRun.sha256).toBe(secondRun.sha256);
    expect(firstRun.originalWidth).toBe(4000);
    expect(firstRun.originalHeight).toBe(3000);
    expect(firstRun.analysisWidth).toBeLessThanOrEqual(
      CHECK_CONFIG.IMAGE_MAX_EDGE
    );
    expect(firstRun.analysisHeight).toBeLessThanOrEqual(
      CHECK_CONFIG.IMAGE_MAX_EDGE
    );
    expect(Math.max(firstRun.analysisWidth, firstRun.analysisHeight)).toBe(
      CHECK_CONFIG.IMAGE_MAX_EDGE
    );

    const analysisMeta = await sharp(firstRun.analysisJpegBuffer).metadata();
    expect(analysisMeta.format).toBe("jpeg");
  });

  it("Loại bỏ tên thương hiệu/sản phẩm khỏi description & alt_text nếu không có trong visible_text (R-17)", () => {
    const sanitized = sanitizeAndValidateImageAnalysis(
      {
        description:
          "Hình chụp máy pha cà phê LumiBrew Mini X1 của LumiBrew Việt Nam trên bàn gỗ.",
        alt_text: "Máy pha cà phê LumiBrew Mini X1 màu bạc",
        subjects: ["máy pha cà phê", "bàn gỗ"],
        visible_text: null,
      },
      {
        brand_name: "LumiBrew Việt Nam",
        products: [
          {
            id: "prod-1",
            name: "LumiBrew Mini X1",
            description: "Máy pha cà phê",
            price: 4890000,
            price_formatted: "4.890.000 VNĐ",
            specs: {},
          },
        ],
      }
    );

    expect(sanitized.description).not.toContain("LumiBrew Mini X1");
    expect(sanitized.description).not.toContain("LumiBrew Việt Nam");
    expect(sanitized.alt_text).not.toContain("LumiBrew Mini X1");
  });
});

