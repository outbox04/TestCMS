# PHASE 3 — THIẾT KẾ CONTENT ORCHESTRATOR REPORT, INTERNAL LINKS & BÀN GIAO 4 PHẦN (CONTENT SEO AGENT V2)

> **Ngày thiết kế**: 2026-11-18
> **Mục tiêu Phase 3**:
> 1. Chuẩn hóa **Đầu ra Điều phối 11 trường của Content Orchestrator** (`job_id`, `website_id`, `brand_id`, `workflow_status`, `current_agent`, `completed_agents`, `pending_tasks`, `quality_status`, `evidence_status`, `approval_required`, `final_artifact_reference`).
> 2. Tự động gợi ý **Internal Links an toàn (`R-23`)** từ danh sách các bài viết `published` có thật trên hệ thống (tuyệt đối không tự bịa URL nội bộ chưa tồn tại).
> 3. Xuất báo cáo **Website Content Standard 4 Phần (`PHẦN A – SEO METADATA`, `PHẦN B – NỘI DUNG WEBSITE`, `PHẦN C – SEO ASSETS`, `PHẦN D – QUALITY REPORT`)** ngay trên trang quản trị `/admin/articles/[id]`.
> 4. Kiểm chứng `npm run typecheck`, `npm run test` và `npm run build` (Production Build).

---

## 1. Cấu Trúc Đầu Ra Content Orchestrator (`lib/writing-engine/orchestrator-report.ts`)

### 1.1. Sơ Đồ Ánh Xạ Trạng Thái Bài Viết (`article_status`) Sang Tiến Trình Orchestrator

| `article.status` | `workflow_status` | `current_agent` | `completed_agents` | `approval_required` |
| :--- | :--- | :--- | :--- | :---: |
| `outline_draft` | `IN_PROGRESS` | `Research Agent & SEO Strategist` | `["Content Orchestrator"]` | `true` |
| `outline_review` | `AWAITING_GATE_1_APPROVAL` | `Human Reviewer (Gate 1)` | `["Content Orchestrator", "Research Agent", "SEO Strategist", "Content Architect"]` | `true` |
| `awaiting_images` | `AWAITING_IMAGE_UPLOAD` | `Human Editor (Image Upload)` | `["Content Orchestrator", "Research Agent", "SEO Strategist", "Content Architect"]` | `true` |
| `analyzing_images` | `IN_PROGRESS` | `Vision Image Analyzer` | `["Content Orchestrator", "Research Agent", "SEO Strategist", "Content Architect"]` | `true` |
| `writing` | `IN_PROGRESS` (hoặc `NEEDS_HUMAN_REVIEW` nếu thiếu dữ kiện) | `Content Writer & Fact Checker` | `["Content Orchestrator", "Research Agent", "SEO Strategist", "Content Architect", "Vision Image Analyzer"]` | `true` |
| `draft_ready` | `IN_PROGRESS` | `SEO Auditor` | `["Content Orchestrator", "Research Agent", "SEO Strategist", "Content Architect", "Vision Image Analyzer", "Content Writer", "GEO & AEO Agent", "Fact Checker"]` | `true` |
| `preview_review` | `AWAITING_GATE_2_APPROVAL` | `Human Reviewer (Gate 2)` | Toàn bộ 8 Agent chuyên môn + `CMS Draft Publisher` | `true` |
| `scheduled` | `SCHEDULED` | `CMS Cron Publisher` | Toàn bộ 8 Agent + `Human Reviewer` | `false` |
| `published` | `PUBLISHED` | `Completed` | Toàn bộ quy trình 11 bước | `false` |

### 1.2. Quản Lý Trạng Thái Bằng Chứng (`evidence_status`) & Chất Lượng (`quality_status`)
- **`evidence_status`**:
  - `"NEEDS_HUMAN_REVIEW"`: Khi `needs_info` khác rỗng hoặc có bất kỳ khối nào mang nhãn `"NEEDS_VERIFICATION"` / lỗi `brand_facts_and_claims`.
  - `"VERIFIED"`: Khi bài viết đã có `content_blocks`, `needs_info` rỗng và `brand_facts_and_claims` đạt.
  - `"PENDING_VERIFICATION"`: Khi bài viết đang ở giai đoạn lập dàn ý/chờ viết.
- **`quality_status`**:
  - Lấy trực tiếp từ `check_report.quality_score.band` (`READY_TO_PUBLISH`, `MINOR_EDITS`, `MAJOR_OPTIMIZATION`, `REWRITE_REQUIRED`, `BLOCKED_BY_TRUTH`) hoặc `"NOT_EVALUATED"` nếu chưa tới bước viết bài.

---

## 2. Gợi Ý Liên Kết Nội Bộ Xác Thực (`suggestInternalLinks` — Quy tắc `R-23`)

Để tuân thủ nghiêm ngặt quy tắc `R-23` (*"Dùng anchor text tự nhiên, mô tả đúng ngữ cảnh; cấm dùng neo vô nghĩa như 'click here' hoặc tự bịa URL chưa kiểm chứng"*):
- Hàm `suggestInternalLinks()` chỉ quét danh sách các bài viết **đã xuất bản (`status = 'published'`) và có `slug` thực tế** trong bảng `articles`.
- So khớp độ liên quan ngữ nghĩa dựa trên từ khóa chính, từ khóa phụ và tên sản phẩm để đề xuất:
  - `anchor_text`: Tiêu đề hoặc cụm từ khóa tự nhiên của bài đích.
  - `target_url`: `/blog/${targetArticle.slug}` (URL tồn tại 100%).
  - `reason`: Lý do liên kết phục vụ hành trình tìm hiểu của người đọc (Topic Cluster).

---

## 3. Xuất Báo Cáo 4 Phần (`WebsiteContentStandardDeliverable`)

Hàm `buildWebsiteContentStandardExport()` tổng hợp đầy đủ 4 phần theo đúng mục 9 của **Website Content Standard Agent**:
- **PHẦN A – SEO METADATA**: `seo_title`, `meta_description`, `slug`, `primary_keyword`, `secondary_keywords`, `search_intent`.
- **PHẦN B – NỘI DUNG WEBSITE**: `h1`, `sapo` (đoạn mở đầu), `headings_and_blocks` (`h2`, `h3`, `paragraph`, `list`, `table`, `callout`), `faqs`, `conclusion`.
- **PHẦN C – SEO ASSETS**: Danh sách ảnh (`article_assets` kèm `alt`), gợi ý `internal_links` thực tế, `external_links_policy`, và `schema_types` (`@graph` JSON-LD).
- **PHẦN D – QUALITY REPORT**: Điểm chi tiết 5 trụ cột (`SEO /25`, `GEO /25`, `AEO /20`, `TRUST /15`, `UX /15`, `Tổng /100`), danh sách `needs_verification` và `errors_to_fix`.

