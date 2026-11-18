import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAllArticleChecks } from "@/lib/checks";
import type {
  AiAuthType,
  AiConnectionStatus,
  AiProviderConnectionRow,
  AiProviderId,
  AiProviderLogRow,
  AiProviderTaskStatus,
  AiRunRow,
  AiSettingsRow,
  ArticleAssetRow,
  ArticleEventRow,
  ArticleRow,
  ArticleStatus,
  BrandProfileRow,
  ContentBlock,
} from "./types";

interface QueueJob {
  msg_id: number;
  message: {
    step: "plan_outline" | "analyze_images" | "write_article" | "revalidate";
    article_id: string;
    version: number;
  };
  read_ct: number;
  archived: boolean;
}

interface LocalDemoState {
  schemaVersion: number;
  currentRole: "admin" | "editor";
  aiSettings: AiSettingsRow;
  vaultApiKey: string | null;
  brandProfile: BrandProfileRow;
  articles: ArticleRow[];
  articleAssets: ArticleAssetRow[];
  articleEvents: ArticleEventRow[];
  aiRuns: AiRunRow[];
  aiProviderConnections: AiProviderConnectionRow[];
  aiProviderLogs: AiProviderLogRow[];
  keywordCache: Array<{
    keyword: string;
    source: string;
    lang: string;
    country: string;
    results: unknown;
    fetched_at: string;
  }>;
  queue: QueueJob[];
  storageBlobs: Map<string, Buffer>;
  nextEventId: number;
  nextAiRunId: number;
  nextProviderLogId: number;
  nextMsgId: number;
}

const CURRENT_DEMO_SCHEMA_VERSION = 7;

const VALID_TRANSITIONS: Array<{
  from: ArticleStatus;
  to: ArticleStatus;
  actor: "editor" | "agent" | "system";
}> = [
  { from: "outline_draft", to: "outline_review", actor: "agent" },
  { from: "outline_review", to: "outline_draft", actor: "editor" },
  { from: "outline_review", to: "awaiting_images", actor: "editor" },
  { from: "awaiting_images", to: "analyzing_images", actor: "editor" },
  { from: "analyzing_images", to: "writing", actor: "agent" },
  { from: "writing", to: "draft_ready", actor: "agent" },
  { from: "draft_ready", to: "preview_review", actor: "agent" },
  { from: "preview_review", to: "writing", actor: "editor" },
  { from: "preview_review", to: "published", actor: "editor" },
  { from: "preview_review", to: "scheduled", actor: "editor" },
  { from: "scheduled", to: "preview_review", actor: "editor" },
  { from: "scheduled", to: "published", actor: "system" },
];

const globalForDemo = globalThis as unknown as {
  __contentAgentDemoState?: LocalDemoState;
};

// 1x1 pixel valid JPEG base64 cho ảnh mẫu khởi tạo sẵn
const SAMPLE_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

function initDemoState(): LocalDemoState {
  const fixturePath = path.join(process.cwd(), "fixtures", "brand.demo.json");
  const rawBrand = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const now = new Date().toISOString();
  const dayMs = 24 * 60 * 60 * 1000;

  const brandProfile: BrandProfileRow = {
    id: true,
    brand_name: rawBrand.brand_name,
    description: rawBrand.description,
    products: rawBrand.products,
    voice: rawBrand.voice,
    facts: rawBrand.facts,
    forbidden_claims: rawBrand.forbidden_claims,
    updated_by: "00000000-0000-0000-0000-000000000010",
    updated_at: now,
  };

  const art1Id = "11111111-1111-4111-8111-111111111101";
  const art2Id = "22222222-2222-4222-8222-222222222202";
  const art3Id = "33333333-3333-4333-8333-333333333303";
  const art4Id = "44444444-4444-4444-8444-444444444404";

  const asset1Id = "aaaaaaaa-1111-4111-8111-111111111101";
  const asset2Id = "aaaaaaaa-2222-4222-8222-222222222202";
  const asset4Id = "aaaaaaaa-4444-4444-8444-444444444404";

  const blocksArt1: ContentBlock[] = [
    {
      type: "h2",
      text: "Thông số nổi bật của máy pha cà phê LumiBrew Mini X1",
    },
    {
      type: "paragraph",
      text: "Máy pha cà phê LumiBrew Mini X1 có giá niêm yết 4.890.000 VNĐ, công suất 1350W và áp suất bơm 15 bar, giúp làm nóng nhanh trong 35 giây cùng bộ điều khiển PID giữ nhiệt ở mức 92 độ C.",
      fact_ids: ["fact-01", "fact-02", "fact-03"],
    },
    {
      type: "image",
      asset_id: asset1Id,
      alt: "Góc pha chế cà phê espresso tại bàn bếp gia đình",
      caption: "Thiết bị pha cà phê espresso nhỏ gọn kiểm soát nhiệt độ PID",
    },
    {
      type: "h2",
      text: "Kết hợp cùng máy xay hạt LumiGrind Pro G2 chuẩn mịn",
    },
    {
      type: "paragraph",
      text: "Máy xay cà phê LumiGrind Pro G2 có giá niêm yết 2.490.000 VNĐ, công suất 180W, trang bị lưỡi xay phẳng 48 mm với 38 cấp độ mịn và tốc độ quay 450 vòng/phút.",
      fact_ids: ["fact-04", "fact-05"],
    },
    {
      type: "list",
      ordered: false,
      items: [
        "Pha espresso trên LumiBrew Mini X1: chỉnh độ mịn từ cấp 5 đến cấp 10 trên LumiGrind Pro G2.",
        "Pha pour-over (V60): chỉnh độ mịn từ cấp 22 đến cấp 28.",
      ],
      fact_ids: ["fact-06", "fact-07"],
    },
    {
      type: "faq",
      q: "Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?",
      a: "LumiBrew Mini X1 làm nóng nước trong 35 giây với bình nước tháo rời dung tích 1.2 lít và trọng lượng máy 4.2 kg.",
      fact_ids: ["fact-02"],
    },
    {
      type: "faq",
      q: "Nên chỉnh cấp độ mịn nào trên LumiGrind Pro G2 khi pha espresso?",
      a: "Khi pha espresso với LumiBrew Mini X1, mức độ mịn khuyến nghị trên máy xay LumiGrind Pro G2 là từ cấp 5 đến cấp 10.",
      fact_ids: ["fact-06"],
    },
  ];

  const seoArt1 = {
    title: "Hướng dẫn pha espresso với máy LumiBrew Mini X1",
    meta_description:
      "Tìm hiểu thông số áp suất 15 bar, bộ điều khiển nhiệt độ PID 92 độ C và cách pha cà phê với LumiBrew Mini X1.",
    needs_info: [],
  };

  const reportArt1 = runAllArticleChecks({
    primaryKeyword: "LumiBrew Mini X1",
    slug: "huong-dan-pha-espresso-lumibrew-mini-x1",
    seo: seoArt1,
    contentBlocks: blocksArt1,
    needsInfo: [],
    brandProfile,
    assets: [{ id: asset1Id, alt_text: "Góc pha chế cà phê espresso tại bàn bếp gia đình" }],
  });

  const blocksArt2: ContentBlock[] = [
    {
      type: "h2",
      text: "Cấu tạo lưỡi xay phẳng 48 mm trên LumiGrind Pro G2",
    },
    {
      type: "paragraph",
      text: "Máy xay LumiGrind Pro G2 có giá niêm yết 2.490.000 VNĐ, công suất 180W, sử dụng lưỡi xay phẳng đường kính 48 mm với tốc độ quay 450 vòng/phút và trọng lượng 2.6 kg.",
      fact_ids: ["fact-04", "fact-05"],
    },
    {
      type: "image",
      asset_id: asset2Id,
      alt: "Hạt cà phê rang mộc và cốc đong định lượng trên bàn gỗ",
      caption: "Chọn đúng cấp độ mịn trong 38 cấp độ giúp chiết xuất đồng đều",
    },
    {
      type: "h2",
      text: "Bảng cấp độ mịn khuyến nghị cho Espresso và Pour-over",
    },
    {
      type: "paragraph",
      text: "Trên tổng số 38 cấp độ xay và phễu chứa hạt 250 g của LumiGrind Pro G2, người dùng dễ dàng chuyển đổi giữa cấp 5 đến cấp 10 cho espresso và cấp 22 đến cấp 28 cho pour-over.",
      fact_ids: ["fact-05", "fact-06", "fact-07"],
    },
    {
      type: "faq",
      q: "Mức độ mịn nào trên LumiGrind Pro G2 phù hợp để pha V60?",
      a: "Với phương pháp pour-over V60, mức độ mịn khuyến nghị trên máy xay LumiGrind Pro G2 là từ cấp 22 đến cấp 28.",
      fact_ids: ["fact-07"],
    },
  ];

  const seoArt2 = {
    title: "Cách chỉnh 38 cấp độ mịn trên máy xay LumiGrind Pro G2",
    meta_description:
      "Hướng dẫn chọn cấp độ mịn từ cấp 5 đến cấp 28 trên máy xay cà phê hạt lưỡi phẳng 48 mm LumiGrind Pro G2.",
    needs_info: [],
  };

  const reportArt2 = runAllArticleChecks({
    primaryKeyword: "LumiGrind Pro G2",
    slug: "cach-chinh-38-cap-do-min-lumigrind-pro-g2",
    seo: seoArt2,
    contentBlocks: blocksArt2,
    needsInfo: [],
    brandProfile,
    assets: [{ id: asset2Id, alt_text: "Hạt cà phê rang mộc và cốc đong định lượng trên bàn gỗ" }],
  });

  const blocksArt4: ContentBlock[] = [
    {
      type: "h2",
      text: "Thông tin sản phẩm LumiBrew Mini X1 hiện có trong hồ sơ",
    },
    {
      type: "paragraph",
      text: "Máy pha cà phê LumiBrew Mini X1 có giá niêm yết 4.890.000 VNĐ, công suất 1350W và áp suất bơm 15 bar của thương hiệu LumiBrew Việt Nam thành lập năm 2024.",
      fact_ids: ["fact-01", "fact-08"],
    },
    {
      type: "image",
      asset_id: asset4Id,
      alt: "Thiết bị pha chế cà phê đặt tại quầy",
    },
    {
      type: "h2",
      text: "Lưu ý về thông tin chính sách bảo hành và đổi trả",
    },
    {
      type: "paragraph",
      text: "Hiện tại hồ sơ thương hiệu chưa cung cấp quy định về thời hạn bảo hành và điều kiện đổi trả nên Agent không tự ý suy diễn số liệu.",
      fact_ids: ["fact-08"],
    },
    {
      type: "faq",
      q: "LumiBrew Việt Nam được thành lập vào năm nào?",
      a: "LumiBrew Việt Nam thành lập năm 2024 tại TP. Hồ Chí Minh, chuyên thiết bị pha cà phê tại nhà.",
      fact_ids: ["fact-08"],
    },
  ];

  const seoArt4 = {
    title: "Chính sách bảo hành máy pha cà phê LumiBrew Mini X1",
    meta_description:
      "Tra cứu thông tin sản phẩm và lưu ý cập nhật chính sách bảo hành đổi trả cho máy pha cà phê LumiBrew Mini X1.",
    needs_info: [
      "Thiếu thông tin chính sách bảo hành và đổi trả trong brand_profile (Kịch bản C — Chặn tự bịa).",
    ],
  };

  const reportArt4 = runAllArticleChecks({
    primaryKeyword: "LumiBrew Mini X1",
    slug: "chinh-sach-bao-hanh-lumibrew-mini-x1",
    seo: seoArt4,
    contentBlocks: blocksArt4,
    needsInfo: seoArt4.needs_info,
    brandProfile,
    assets: [{ id: asset4Id, alt_text: "Thiết bị pha chế cà phê đặt tại quầy" }],
  });

  const articles: ArticleRow[] = [
    {
      id: art1Id,
      topic: "Hướng dẫn pha cà phê espresso chuẩn vị tại nhà với máy LumiBrew Mini X1",
      slug: "huong-dan-pha-espresso-lumibrew-mini-x1",
      planned_publish_at: new Date(Date.now() + 1 * dayMs).toISOString(),
      status: "published",
      version: 8,
      primary_keyword: "LumiBrew Mini X1",
      secondary_keywords: [
        "máy pha cà phê espresso gia đình",
        "máy xay cà phê LumiGrind Pro G2",
        "kiểm soát nhiệt độ PID 92 độ C",
      ],
      faq_questions: [
        "Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?",
        "Nên chỉnh cấp độ mịn nào trên LumiGrind Pro G2 khi pha espresso?",
      ],
      outline: {
        items: [
          {
            h2: "Thông số nổi bật của máy pha cà phê LumiBrew Mini X1",
            key_points: [
              "Giá 4.890.000 VNĐ, công suất 1350W, áp suất 15 bar, làm nóng 35 giây",
              "Kiểm soát nhiệt độ PID giữ ổn định ở 92 độ C",
            ],
            fact_ids: ["fact-01", "fact-02", "fact-03"],
          },
          {
            h2: "Kết hợp cùng máy xay hạt LumiGrind Pro G2 chuẩn mịn",
            key_points: [
              "Lưỡi phẳng 48 mm, 38 cấp độ mịn, khuyến nghị cấp 5–10 cho espresso",
            ],
            fact_ids: ["fact-04", "fact-05", "fact-06"],
          },
        ],
        needs_info: [],
      },
      content_blocks: blocksArt1,
      seo: seoArt1,
      checks_passed: true,
      check_report: reportArt1,
      scheduled_at: null,
      published_at: now,
      last_error: null,
      created_by: "00000000-0000-0000-0000-000000000010",
      created_at: now,
      updated_at: now,
    },
    {
      id: art2Id,
      topic: "Cách chọn cấp độ mịn trên máy xay LumiGrind Pro G2 cho espresso và pour-over",
      slug: "cach-chinh-38-cap-do-min-lumigrind-pro-g2",
      planned_publish_at: new Date(Date.now() + 2 * dayMs).toISOString(),
      status: "preview_review",
      version: 7,
      primary_keyword: "LumiGrind Pro G2",
      secondary_keywords: [
        "máy xay cà phê lưỡi phẳng 48mm",
        "38 cấp độ mịn cà phê",
        "cách pha pour over V60",
      ],
      faq_questions: [
        "Mức độ mịn nào trên LumiGrind Pro G2 phù hợp để pha V60?",
      ],
      outline: {
        items: [
          {
            h2: "Cấu tạo lưỡi xay phẳng 48 mm trên LumiGrind Pro G2",
            key_points: ["Công suất 180W, tốc độ 450 vòng/phút, nặng 2.6 kg"],
            fact_ids: ["fact-04", "fact-05"],
          },
          {
            h2: "Bảng cấp độ mịn khuyến nghị cho Espresso và Pour-over",
            key_points: ["Cấp 5–10 cho espresso, cấp 22–28 cho pour-over"],
            fact_ids: ["fact-06", "fact-07"],
          },
        ],
        needs_info: [],
      },
      content_blocks: blocksArt2,
      seo: seoArt2,
      checks_passed: true,
      check_report: reportArt2,
      scheduled_at: null,
      published_at: null,
      last_error: null,
      created_by: "00000000-0000-0000-0000-000000000010",
      created_at: now,
      updated_at: now,
    },
    {
      id: art3Id,
      topic: "Vì sao kiểm soát nhiệt độ PID 92 độ C trên LumiBrew Mini X1 quyết định hương vị espresso?",
      slug: null,
      planned_publish_at: new Date(Date.now() + 3 * dayMs).toISOString(),
      status: "outline_review",
      version: 2,
      primary_keyword: "LumiBrew Mini X1",
      secondary_keywords: [
        "nhiệt độ nước pha cà phê espresso chuẩn",
        "máy pha cà phê kiểm soát nhiệt độ PID",
      ],
      faq_questions: [
        "Bộ điều khiển PID trên LumiBrew Mini X1 giữ nhiệt độ nước ở bao nhiêu độ C?",
        "Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?",
      ],
      outline: {
        items: [
          {
            h2: "Vai trò của bộ điều khiển nhiệt độ PID 92 độ C trên LumiBrew Mini X1",
            key_points: [
              "Giữ nhiệt độ nước chiết xuất ổn định ở 92 độ C",
              "Kết hợp công suất 1350W và áp suất bơm 15 bar, làm nóng trong 35 giây",
            ],
            fact_ids: ["fact-01", "fact-02", "fact-03"],
          },
          {
            h2: "Phối hợp cùng độ mịn cấp 5–10 trên máy xay LumiGrind Pro G2",
            key_points: [
              "Độ mịn đồng đều từ lưỡi phẳng 48 mm giúp dòng chảy ổn định",
            ],
            fact_ids: ["fact-04", "fact-06"],
          },
        ],
        needs_info: [],
      },
      content_blocks: null,
      seo: null,
      checks_passed: false,
      check_report: null,
      scheduled_at: null,
      published_at: null,
      last_error: null,
      created_by: "00000000-0000-0000-0000-000000000010",
      created_at: now,
      updated_at: now,
    },
    {
      id: art4Id,
      topic: "Chính sách bảo hành và đổi trả máy pha cà phê LumiBrew Mini X1 (Kịch bản C — Bẫy chống bịa)",
      slug: "chinh-sach-bao-hanh-lumibrew-mini-x1",
      planned_publish_at: new Date(Date.now() + 4 * dayMs).toISOString(),
      status: "writing",
      version: 5,
      primary_keyword: "LumiBrew Mini X1",
      secondary_keywords: ["chính sách bảo hành máy pha cà phê LumiBrew"],
      faq_questions: ["LumiBrew Việt Nam được thành lập vào năm nào?"],
      outline: {
        items: [
          {
            h2: "Thông tin sản phẩm LumiBrew Mini X1 hiện có trong hồ sơ",
            key_points: ["Giá 4.890.000 VNĐ, công suất 1350W, áp suất 15 bar"],
            fact_ids: ["fact-01", "fact-08"],
          },
          {
            h2: "Lưu ý về thông tin chính sách bảo hành và đổi trả",
            key_points: ["Chưa có dữ liệu bảo hành/đổi trả trong brand_profile"],
            fact_ids: ["fact-08"],
          },
        ],
        needs_info: [
          "Thiếu thông tin chính sách bảo hành và đổi trả trong brand_profile (Kịch bản C — Chặn tự bịa).",
        ],
      },
      content_blocks: blocksArt4,
      seo: seoArt4,
      checks_passed: false,
      check_report: reportArt4,
      scheduled_at: null,
      published_at: null,
      last_error:
        "Kiểm tra tự động chưa đạt: - [needs_info_empty] Bài viết còn thiếu thông tin từ hồ sơ thương hiệu (needs_info): Thiếu thông tin chính sách bảo hành và đổi trả trong brand_profile (Kịch bản C — Chặn tự bịa). [R-31, R-34]",
      created_by: "00000000-0000-0000-0000-000000000010",
      created_at: now,
      updated_at: now,
    },
  ];

  const sampleBuf = Buffer.from(SAMPLE_JPEG_BASE64, "base64");
  const storageBlobs = new Map<string, Buffer>();
  storageBlobs.set(`${art1Id}/orig-demo1.jpg`, sampleBuf);
  storageBlobs.set(`${art1Id}/analysis-demo1.jpg`, sampleBuf);
  storageBlobs.set(`${art2Id}/orig-demo2.jpg`, sampleBuf);
  storageBlobs.set(`${art2Id}/analysis-demo2.jpg`, sampleBuf);
  storageBlobs.set(`${art4Id}/orig-demo4.jpg`, sampleBuf);
  storageBlobs.set(`${art4Id}/analysis-demo4.jpg`, sampleBuf);

  const articleAssets: ArticleAssetRow[] = [
    {
      id: asset1Id,
      article_id: art1Id,
      storage_path: `${art1Id}/orig-demo1.jpg`,
      analysis_path: `${art1Id}/analysis-demo1.jpg`,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      width: 2400,
      height: 1600,
      alt_text: "Góc pha chế cà phê espresso tại bàn bếp gia đình",
      analysis: {
        description:
          "Hình ảnh góc pha chế cà phê espresso trên bàn bếp với ánh sáng tự nhiên.",
        alt_text: "Góc pha chế cà phê espresso tại bàn bếp gia đình",
        subjects: ["góc pha chế", "ly espresso", "bàn bếp"],
        visible_text: null,
      },
      analyzed_at: now,
      created_by: "00000000-0000-0000-0000-000000000010",
      created_at: now,
    },
    {
      id: asset2Id,
      article_id: art2Id,
      storage_path: `${art2Id}/orig-demo2.jpg`,
      analysis_path: `${art2Id}/analysis-demo2.jpg`,
      sha256: "a1b2c3d498fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b111",
      width: 2000,
      height: 1500,
      alt_text: "Hạt cà phê rang mộc và cốc đong định lượng trên bàn gỗ",
      analysis: {
        description: "Hình chụp hạt cà phê rang mộc cùng phụ kiện đong định lượng.",
        alt_text: "Hạt cà phê rang mộc và cốc đong định lượng trên bàn gỗ",
        subjects: ["hạt cà phê", "cốc đong", "bàn gỗ"],
        visible_text: null,
      },
      analyzed_at: now,
      created_by: "00000000-0000-0000-0000-000000000010",
      created_at: now,
    },
    {
      id: asset4Id,
      article_id: art4Id,
      storage_path: `${art4Id}/orig-demo4.jpg`,
      analysis_path: `${art4Id}/analysis-demo4.jpg`,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      width: 2400,
      height: 1600,
      alt_text: "Thiết bị pha chế cà phê đặt tại quầy",
      analysis: {
        description:
          "Hình ảnh góc pha chế cà phê espresso trên bàn bếp với ánh sáng tự nhiên.",
        alt_text: "Thiết bị pha chế cà phê đặt tại quầy",
        subjects: ["góc pha chế", "bàn bếp"],
        visible_text: null,
      },
      analyzed_at: now,
      created_by: "00000000-0000-0000-0000-000000000010",
      created_at: now,
    },
  ];

  const articleEvents: ArticleEventRow[] = [
    {
      id: 1,
      article_id: art1Id,
      from_status: "outline_draft",
      to_status: "outline_review",
      actor: null,
      actor_kind: "agent",
      note: "Agent hoàn tất lập dàn ý & từ khóa",
      created_at: now,
    },
    {
      id: 2,
      article_id: art1Id,
      from_status: "outline_review",
      to_status: "awaiting_images",
      actor: "00000000-0000-0000-0000-000000000010",
      actor_kind: "editor",
      note: "Nhân viên duyệt ý chính tại Cổng 1",
      created_at: now,
    },
    {
      id: 3,
      article_id: art1Id,
      from_status: "awaiting_images",
      to_status: "analyzing_images",
      actor: "00000000-0000-0000-0000-000000000010",
      actor_kind: "editor",
      note: "Đã upload xong ảnh, chuyển cho Agent phân tích",
      created_at: now,
    },
    {
      id: 4,
      article_id: art1Id,
      from_status: "analyzing_images",
      to_status: "writing",
      actor: null,
      actor_kind: "agent",
      note: "Đã phân tích 1 ảnh mới (resize <= 1568px JPEG)",
      created_at: now,
    },
    {
      id: 5,
      article_id: art1Id,
      from_status: "writing",
      to_status: "draft_ready",
      actor: null,
      actor_kind: "agent",
      note: "Agent hoàn tất viết bài nháp",
      created_at: now,
    },
    {
      id: 6,
      article_id: art1Id,
      from_status: "draft_ready",
      to_status: "preview_review",
      actor: null,
      actor_kind: "agent",
      note: "Kiểm tra tự động đạt 6/6, chuyển sang Cổng 2 (preview_review)",
      created_at: now,
    },
    {
      id: 7,
      article_id: art1Id,
      from_status: "preview_review",
      to_status: "published",
      actor: "00000000-0000-0000-0000-000000000010",
      actor_kind: "editor",
      note: "Nhân viên duyệt Đăng ngay tại Cổng 2",
      created_at: now,
    },
  ];

  const aiRuns: AiRunRow[] = [
    {
      id: 1,
      article_id: art1Id,
      step: "plan_outline (cached:310)",
      model: "gpt-6.1-sol",
      input_tokens: 420,
      output_tokens: 210,
      cost_usd: 0.00441,
      created_at: now,
    },
    {
      id: 2,
      article_id: art1Id,
      step: "analyze_images",
      model: "gpt-6.1-sol",
      input_tokens: 280,
      output_tokens: 65,
      cost_usd: 0.001815,
      created_at: now,
    },
    {
      id: 3,
      article_id: art1Id,
      step: "write_article (cached:310)",
      model: "gpt-6.1-sol",
      input_tokens: 510,
      output_tokens: 390,
      cost_usd: 0.00738,
      created_at: now,
    },
    {
      id: 4,
      article_id: art2Id,
      step: "write_article (cached:310)",
      model: "gpt-6.1-sol",
      input_tokens: 490,
      output_tokens: 360,
      cost_usd: 0.00687,
      created_at: now,
    },
    {
      id: 5,
      article_id: art4Id,
      step: "write_article (cached:310)",
      model: "gpt-6.1-sol",
      input_tokens: 460,
      output_tokens: 250,
      cost_usd: 0.00513,
      created_at: now,
    },
  ];

  return {
    schemaVersion: CURRENT_DEMO_SCHEMA_VERSION,
    currentRole: "admin",
    aiSettings: {
      id: true,
      provider: "gemini",
      model_writer: "gemini-2.5-flash",
      model_vision: "gemini-2.5-flash",
      api_key_secret_id: "00000000-0000-0000-0000-000000000001",
      api_key_last4: "DEMO",
      monthly_token_budget: 2000000,
      updated_by: "00000000-0000-0000-0000-000000000010",
      updated_at: now,
    },
    vaultApiKey: "LOCAL_DEMO_MODE_KEY",
    brandProfile,
    articles,
    articleAssets,
    articleEvents,
    aiRuns,
    aiProviderConnections: [],
    aiProviderLogs: [],
    keywordCache: [],
    queue: [],
    storageBlobs,
    nextEventId: 20,
    nextAiRunId: 20,
    nextProviderLogId: 1,
    nextMsgId: 20,
  };
}

export function getDemoState(): LocalDemoState {
  if (
    !globalForDemo.__contentAgentDemoState ||
    globalForDemo.__contentAgentDemoState.schemaVersion !==
      CURRENT_DEMO_SCHEMA_VERSION
  ) {
    const prevArticles =
      globalForDemo.__contentAgentDemoState?.articles ?? [];
    const prevAssets =
      globalForDemo.__contentAgentDemoState?.articleAssets ?? [];
    const prevBlobs = globalForDemo.__contentAgentDemoState?.storageBlobs;
    const prevVaultKey = globalForDemo.__contentAgentDemoState?.vaultApiKey;
    const prevAiSettings = globalForDemo.__contentAgentDemoState?.aiSettings;

    const fresh = initDemoState();
    if (
      prevVaultKey &&
      prevVaultKey !== "LOCAL_DEMO_MODE_KEY" &&
      !prevVaultKey.endsWith("86b171") &&
      prevAiSettings &&
      prevAiSettings.model_writer !== "gpt-6.1-sol"
    ) {
      fresh.vaultApiKey = prevVaultKey;
      fresh.aiSettings = prevAiSettings;
    }
    const seenTopicPrefixes = new Set(
      fresh.articles.map((a) =>
        a.topic.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 50)
      )
    );
    for (const oldArt of prevArticles) {
      const prefix = oldArt.topic
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 50);
      if (
        !fresh.articles.some((a) => a.id === oldArt.id) &&
        !seenTopicPrefixes.has(prefix)
      ) {
        seenTopicPrefixes.add(prefix);
        fresh.articles.unshift(oldArt);
      }
    }
    for (const oldAsset of prevAssets) {
      if (!fresh.articleAssets.some((a) => a.id === oldAsset.id)) {
        fresh.articleAssets.push(oldAsset);
      }
    }
    if (prevBlobs) {
      for (const [k, v] of prevBlobs.entries()) {
        if (!fresh.storageBlobs.has(k)) {
          fresh.storageBlobs.set(k, v);
        }
      }
    }
    globalForDemo.__contentAgentDemoState = fresh;
  }

  const st = globalForDemo.__contentAgentDemoState;
  for (const art of st.articles) {
    const topicLower = art.topic.toLowerCase();
    const isRealWarrantyTrap =
      topicLower.includes("bảo hành") || topicLower.includes("đổi trả");
    if (
      !isRealWarrantyTrap &&
      art.status === "writing" &&
      art.last_error?.includes("needs_info_empty") &&
      Array.isArray(art.content_blocks) &&
      art.content_blocks.length > 0 &&
      art.seo
    ) {
      art.seo.needs_info = [];
      if (art.outline && !Array.isArray(art.outline)) {
        art.outline.needs_info = [];
      }
      const artAssets = st.articleAssets
        .filter((a) => a.article_id === art.id)
        .map((a) => ({ id: a.id, alt_text: a.alt_text }));
      const report = runAllArticleChecks({
        primaryKeyword: art.primary_keyword ?? art.topic,
        slug: art.slug ?? "bai-viet-demo",
        seo: art.seo,
        contentBlocks: art.content_blocks,
        needsInfo: [],
        brandProfile: st.brandProfile,
        assets: artAssets,
      });
      art.check_report = report;
      if (report.passed) {
        art.checks_passed = true;
        art.last_error = null;
        art.status = "preview_review";
        art.version += 2;
      }
    }
  }

  return st;
}

export function resetDemoState(): LocalDemoState {
  globalForDemo.__contentAgentDemoState = initDemoState();
  return globalForDemo.__contentAgentDemoState;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  );
}

function isBrandReady(brand: BrandProfileRow): boolean {
  return Boolean(
    (brand.brand_name ?? "").trim().length > 0 &&
      Array.isArray(brand.products) &&
      brand.products.length > 0 &&
      (brand.voice ?? "").trim().length > 0
  );
}

function enqueueJobForStatus(
  state: LocalDemoState,
  article: ArticleRow
): void {
  const stepMap: Partial<
    Record<ArticleStatus, QueueJob["message"]["step"]>
  > = {
    outline_draft: "plan_outline",
    analyzing_images: "analyze_images",
    writing: "write_article",
    published: "revalidate",
  };
  const step = stepMap[article.status];
  if (!step) return;

  if (step !== "revalidate" && !isBrandReady(state.brandProfile)) {
    throw new Error(
      "Hồ sơ thương hiệu chưa đủ thông tin (tên, sản phẩm, giọng văn)"
    );
  }

  state.queue.push({
    msg_id: state.nextMsgId++,
    message: {
      step,
      article_id: article.id,
      version: article.version,
    },
    read_ct: 0,
    archived: false,
  });
}

type FilterFn = (row: Record<string, unknown>) => boolean;

class DemoQueryBuilder {
  private table: string;
  private state: LocalDemoState;
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: unknown = null;
  private filters: FilterFn[] = [];
  private sortSpecs: Array<{ col: string; ascending: boolean }> = [];
  private limitNum: number | null = null;
  private singleMode: "none" | "single" | "maybeSingle" = "none";

  constructor(table: string, state: LocalDemoState) {
    this.table = table;
    this.state = state;
  }

  select(_columns?: string): this {
    return this;
  }

  insert(values: unknown): this {
    this.op = "insert";
    this.payload = values;
    return this;
  }

  update(values: unknown): this {
    this.op = "update";
    this.payload = values;
    return this;
  }

  upsert(values: unknown, _opts?: unknown): this {
    this.op = "upsert";
    this.payload = values;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  not(col: string, op: string, val: unknown): this {
    if (op === "is" && val === null) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    }
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.sortSpecs.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.limitNum = n;
    return this;
  }

  single(): Promise<{ data: unknown; error: { message: string } | null }> {
    this.singleMode = "single";
    return this.execute();
  }

  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }> {
    this.singleMode = "maybeSingle";
    return this.execute();
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private getTableRows(): Record<string, unknown>[] {
    switch (this.table) {
      case "profiles":
        return [
          {
            id: "00000000-0000-0000-0000-000000000010",
            role: this.state.currentRole,
          },
        ];
      case "ai_settings":
        return [this.state.aiSettings as unknown as Record<string, unknown>];
      case "brand_profile":
        return [this.state.brandProfile as unknown as Record<string, unknown>];
      case "articles":
        return this.state.articles as unknown as Record<string, unknown>[];
      case "article_assets":
        return this.state.articleAssets as unknown as Record<string, unknown>[];
      case "article_events":
        return this.state.articleEvents as unknown as Record<string, unknown>[];
      case "ai_runs":
        return this.state.aiRuns as unknown as Record<string, unknown>[];
      case "ai_provider_connections":
        return this.state.aiProviderConnections as unknown as Record<
          string,
          unknown
        >[];
      case "ai_provider_logs":
        return this.state.aiProviderLogs as unknown as Record<
          string,
          unknown
        >[];
      case "keyword_cache":
        return this.state.keywordCache as unknown as Record<string, unknown>[];
      default:
        return [];
    }
  }

  private async execute(): Promise<{
    data: unknown;
    error: { message: string } | null;
  }> {
    try {
      const now = new Date().toISOString();

      if (this.op === "insert") {
        const item = (
          Array.isArray(this.payload) ? this.payload[0] : this.payload
        ) as Record<string, unknown>;

        if (this.table === "articles") {
          const newArticle: ArticleRow = {
            id: crypto.randomUUID(),
            topic: String(item.topic ?? ""),
            slug: null,
            planned_publish_at: (item.planned_publish_at as string) ?? null,
            status: "outline_draft",
            version: 1,
            primary_keyword: (item.primary_keyword as string) ?? null,
            secondary_keywords: (item.secondary_keywords as string[]) ?? [],
            faq_questions: (item.faq_questions as string[]) ?? [],
            outline: null,
            content_blocks: null,
            seo: null,
            checks_passed: false,
            check_report: null,
            scheduled_at: null,
            published_at: null,
            last_error: null,
            created_by: "00000000-0000-0000-0000-000000000010",
            created_at: now,
            updated_at: now,
          };
          enqueueJobForStatus(this.state, newArticle);
          this.state.articles.unshift(newArticle);
          return {
            data: this.singleMode !== "none" ? newArticle : [newArticle],
            error: null,
          };
        }

        if (this.table === "article_assets") {
          const newAsset: ArticleAssetRow = {
            id: crypto.randomUUID(),
            article_id: String(item.article_id),
            storage_path: String(item.storage_path),
            analysis_path: (item.analysis_path as string) ?? null,
            sha256: String(item.sha256),
            width: Number(item.width ?? 0),
            height: Number(item.height ?? 0),
            alt_text: (item.alt_text as string) ?? null,
            analysis: null,
            analyzed_at: null,
            created_by: "00000000-0000-0000-0000-000000000010",
            created_at: now,
          };
          this.state.articleAssets.push(newAsset);
          return {
            data: this.singleMode !== "none" ? newAsset : [newAsset],
            error: null,
          };
        }

        if (this.table === "ai_runs") {
          const newRun: AiRunRow = {
            id: this.state.nextAiRunId++,
            article_id: (item.article_id as string) ?? null,
            step: String(item.step ?? ""),
            model: (item.model as string) ?? null,
            input_tokens: Number(item.input_tokens ?? 0),
            output_tokens: Number(item.output_tokens ?? 0),
            cost_usd: item.cost_usd !== undefined ? Number(item.cost_usd) : null,
            created_at: now,
          };
          this.state.aiRuns.unshift(newRun);
          return { data: newRun, error: null };
        }

        if (this.table === "ai_provider_connections") {
          const provider = (item.provider as AiProviderId) ?? "muse";
          const scope = "global" as const;
          const existingIdx = this.state.aiProviderConnections.findIndex(
            (c) => c.provider === provider && c.scope === scope
          );
          const connRow: AiProviderConnectionRow = {
            id:
              existingIdx >= 0
                ? this.state.aiProviderConnections[existingIdx].id
                : crypto.randomUUID(),
            provider,
            scope,
            auth_type: (item.auth_type as AiAuthType) ?? "api_token",
            encrypted_credentials:
              (item.encrypted_credentials as string | null) ?? null,
            status: (item.status as AiConnectionStatus) ?? "disconnected",
            error_code: (item.error_code as string | null) ?? null,
            error_message: (item.error_message as string | null) ?? null,
            last_verified_at: (item.last_verified_at as string | null) ?? null,
            last_used_at: (item.last_used_at as string | null) ?? null,
            created_by: (item.created_by as string | null) ?? null,
            updated_by: (item.updated_by as string | null) ?? null,
            created_at:
              existingIdx >= 0
                ? this.state.aiProviderConnections[existingIdx].created_at
                : now,
            updated_at: now,
          };
          if (existingIdx >= 0) {
            this.state.aiProviderConnections[existingIdx] = connRow;
          } else {
            this.state.aiProviderConnections.push(connRow);
          }
          return {
            data: this.singleMode !== "none" ? connRow : [connRow],
            error: null,
          };
        }

        if (this.table === "ai_provider_logs") {
          const newLog: AiProviderLogRow = {
            id: this.state.nextProviderLogId++,
            provider: String(item.provider ?? "muse"),
            task_type: String(item.task_type ?? "unknown"),
            user_id: (item.user_id as string | null) ?? null,
            status:
              (item.status as AiProviderTaskStatus) ?? "completed",
            duration_ms: Number(item.duration_ms ?? 0),
            error_code: (item.error_code as string | null) ?? null,
            created_at: now,
          };
          this.state.aiProviderLogs.unshift(newLog);
          return {
            data: this.singleMode !== "none" ? newLog : [newLog],
            error: null,
          };
        }
      }

      if (this.op === "update" || this.op === "upsert") {
        const patch = this.payload as Record<string, unknown>;
        if (this.table === "articles" && "status" in patch) {
          return {
            data: null,
            error: {
              message: "Chỉ được đổi trạng thái qua transition_article()",
            },
          };
        }

        const rows = this.getTableRows().filter((r) =>
          this.filters.every((fn) => fn(r))
        );
        if (this.op === "upsert" && rows.length === 0) {
          if (this.table === "ai_provider_connections") {
            const provider = (patch.provider as AiProviderId) ?? "muse";
            const scope = "global" as const;
            const existingIdx = this.state.aiProviderConnections.findIndex(
              (c) => c.provider === provider && c.scope === scope
            );
            const connRow: AiProviderConnectionRow = {
              id:
                existingIdx >= 0
                  ? this.state.aiProviderConnections[existingIdx].id
                  : crypto.randomUUID(),
              provider,
              scope,
              auth_type: (patch.auth_type as AiAuthType) ?? "api_token",
              encrypted_credentials:
                (patch.encrypted_credentials as string | null) ?? null,
              status: (patch.status as AiConnectionStatus) ?? "disconnected",
              error_code: (patch.error_code as string | null) ?? null,
              error_message: (patch.error_message as string | null) ?? null,
              last_verified_at:
                (patch.last_verified_at as string | null) ?? null,
              last_used_at: (patch.last_used_at as string | null) ?? null,
              created_by: (patch.created_by as string | null) ?? null,
              updated_by: (patch.updated_by as string | null) ?? null,
              created_at:
                existingIdx >= 0
                  ? this.state.aiProviderConnections[existingIdx].created_at
                  : now,
              updated_at: now,
            };
            if (existingIdx >= 0) {
              this.state.aiProviderConnections[existingIdx] = connRow;
            } else {
              this.state.aiProviderConnections.push(connRow);
            }
            return {
              data: this.singleMode !== "none" ? connRow : [connRow],
              error: null,
            };
          }
        }
        for (const r of rows) {
          Object.assign(r, patch, { updated_at: now });
        }
        return {
          data: this.singleMode !== "none" ? (rows[0] ?? null) : rows,
          error: null,
        };
      }

      let rows = [...this.getTableRows()].filter((r) =>
        this.filters.every((fn) => fn(r))
      );

      for (const spec of this.sortSpecs) {
        rows.sort((a, b) => {
          const va = a[spec.col];
          const vb = b[spec.col];
          if (va === vb) return 0;
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          return (va > vb ? 1 : -1) * (spec.ascending ? 1 : -1);
        });
      }

      if (this.limitNum !== null) {
        rows = rows.slice(0, this.limitNum);
      }

      if (this.singleMode === "single") {
        if (rows.length === 0) {
          return { data: null, error: { message: "Không tìm thấy bản ghi" } };
        }
        return { data: structuredClone(rows[0]), error: null };
      }

      if (this.singleMode === "maybeSingle") {
        return {
          data: rows[0] ? structuredClone(rows[0]) : null,
          error: null,
        };
      }

      return { data: structuredClone(rows), error: null };
    } catch (err) {
      return {
        data: null,
        error: {
          message: err instanceof Error ? err.message : "Lỗi Local Demo Store",
        },
      };
    }
  }
}

export function createLocalDemoSupabaseClient(
  isServiceRole: boolean = false
): SupabaseClient {
  const state = getDemoState();

  const client = {
    auth: {
      async getUser() {
        return {
          data: {
            user: {
              id: "00000000-0000-0000-0000-000000000010",
              email: "admin@demo.test (Local Demo)",
            },
          },
          error: null,
        };
      },
      async signInWithPassword() {
        return {
          data: {
            user: {
              id: "00000000-0000-0000-0000-000000000010",
              email: "admin@demo.test",
            },
          },
          error: null,
        };
      },
      async signOut() {
        return { error: null };
      },
    },

    from(table: string) {
      return new DemoQueryBuilder(table, state);
    },

    storage: {
      from(_bucket: string) {
        return {
          async upload(storagePath: string, buf: Buffer | Uint8Array) {
            state.storageBlobs.set(storagePath, Buffer.from(buf));
            return { data: { path: storagePath }, error: null };
          },
          async download(storagePath: string) {
            const buf = state.storageBlobs.get(storagePath);
            if (!buf) {
              return {
                data: null,
                error: { message: `Không tìm thấy file ${storagePath}` },
              };
            }
            const ab = buf.buffer.slice(
              buf.byteOffset,
              buf.byteOffset + buf.byteLength
            ) as ArrayBuffer;
            return {
              data: new Blob([ab], { type: "image/jpeg" }),
              error: null,
            };
          },
          async createSignedUrl(storagePath: string) {
            const buf = state.storageBlobs.get(storagePath);
            if (!buf) {
              return { data: { signedUrl: "" }, error: null };
            }
            const base64 = buf.toString("base64");
            return {
              data: { signedUrl: `data:image/jpeg;base64,${base64}` },
              error: null,
            };
          },
        };
      },
    },

    async rpc(fnName: string, args?: Record<string, unknown>) {
      try {
        if (fnName === "is_admin") {
          return { data: state.currentRole === "admin", error: null };
        }
        if (fnName === "is_editor") {
          return { data: true, error: null };
        }
        if (fnName === "brand_profile_ready") {
          return { data: isBrandReady(state.brandProfile), error: null };
        }
        if (fnName === "ai_tokens_used_this_month") {
          const total = state.aiRuns.reduce(
            (acc, r) => acc + r.input_tokens + r.output_tokens,
            0
          );
          return { data: total, error: null };
        }
        if (fnName === "set_ai_api_key") {
          const key = String(args?.p_key ?? "");
          state.vaultApiKey = key;
          state.aiSettings.api_key_last4 = key.slice(-4);
          state.aiSettings.updated_at = new Date().toISOString();
          return { data: null, error: null };
        }
        if (fnName === "get_ai_api_key") {
          return { data: state.vaultApiKey, error: null };
        }
        if (fnName === "agent_pop_job") {
          const job = state.queue.find((q) => !q.archived);
          if (!job) return { data: [], error: null };
          job.read_ct += 1;
          return {
            data: [
              {
                msg_id: job.msg_id,
                message: job.message,
                read_ct: job.read_ct,
              },
            ],
            error: null,
          };
        }
        if (fnName === "agent_ack_job") {
          const msgId = Number(args?.p_msg_id ?? 0);
          const job = state.queue.find((q) => q.msg_id === msgId);
          if (job) job.archived = true;
          return { data: true, error: null };
        }
        if (fnName === "publish_due_articles") {
          const nowMs = Date.now();
          let count = 0;
          for (const art of state.articles) {
            if (
              art.status === "scheduled" &&
              art.scheduled_at &&
              Date.parse(art.scheduled_at) <= nowMs
            ) {
              art.status = "published";
              art.published_at = new Date().toISOString();
              art.version += 1;
              state.articleEvents.unshift({
                id: state.nextEventId++,
                article_id: art.id,
                from_status: "scheduled",
                to_status: "published",
                actor: null,
                actor_kind: "system",
                note: "Đăng theo lịch",
                created_at: new Date().toISOString(),
              });
              enqueueJobForStatus(state, art);
              count++;
            }
          }
          return { data: count, error: null };
        }
        if (fnName === "transition_article") {
          const articleId = String(args?.p_article_id ?? "");
          const toStatus = String(args?.p_to ?? "") as ArticleStatus;
          const expectedVer = Number(args?.p_expected_version ?? 0);
          const actorKind = isServiceRole
            ? (String(args?.p_actor_kind ?? "agent") as "agent" | "system")
            : "editor";
          const note = (args?.p_note as string) ?? null;

          const article = state.articles.find((a) => a.id === articleId);
          if (!article) {
            return {
              data: null,
              error: { message: "Không tìm thấy bài viết" },
            };
          }
          if (article.version !== expectedVer) {
            return {
              data: null,
              error: { message: "Xung đột phiên bản: bài đã được thay đổi" },
            };
          }

          const allowed = VALID_TRANSITIONS.some(
            (t) =>
              t.from === article.status &&
              t.to === toStatus &&
              t.actor === actorKind
          );
          if (!allowed) {
            return {
              data: null,
              error: {
                message: `Không được chuyển ${article.status} -> ${toStatus} với vai trò ${actorKind}`,
              },
            };
          }

          if (toStatus === "analyzing_images") {
            const hasAssets = state.articleAssets.some(
              (a) => a.article_id === article.id
            );
            if (!hasAssets) {
              return {
                data: null,
                error: { message: "Cần upload ít nhất một ảnh" },
              };
            }
          }

          if (toStatus === "writing" && actorKind === "agent") {
            const hasUnanalyzed = state.articleAssets.some(
              (a) => a.article_id === article.id && !a.analyzed_at
            );
            if (hasUnanalyzed) {
              return {
                data: null,
                error: { message: "Còn ảnh chưa được phân tích" },
              };
            }
          }

          if (
            toStatus === "preview_review" &&
            actorKind === "agent" &&
            !article.checks_passed
          ) {
            return {
              data: null,
              error: { message: "Kiểm tra tự động chưa đạt" },
            };
          }

          if (toStatus === "scheduled") {
            if (
              !article.scheduled_at ||
              Date.parse(article.scheduled_at) <= Date.now()
            ) {
              return {
                data: null,
                error: { message: "Thời điểm lên lịch phải ở tương lai" },
              };
            }
          }

          const prevStatus = article.status;
          article.status = toStatus;
          article.version += 1;
          article.updated_at = new Date().toISOString();
          if (toStatus === "writing") {
            article.checks_passed = false;
          }
          if (toStatus === "published") {
            article.published_at = new Date().toISOString();
          }

          state.articleEvents.unshift({
            id: state.nextEventId++,
            article_id: article.id,
            from_status: prevStatus,
            to_status: toStatus,
            actor: "00000000-0000-0000-0000-000000000010",
            actor_kind: actorKind,
            note,
            created_at: new Date().toISOString(),
          });

          enqueueJobForStatus(state, article);
          return { data: article, error: null };
        }

        return { data: null, error: null };
      } catch (err) {
        return {
          data: null,
          error: {
            message: err instanceof Error ? err.message : "Lỗi gọi RPC demo",
          },
        };
      }
    },
  };

  return client as unknown as SupabaseClient;
}
