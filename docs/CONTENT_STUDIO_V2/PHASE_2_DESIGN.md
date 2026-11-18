# PHASE 2 — THIẾT KẾ TRÌNH BIÊN TẬP TRỰC QUAN & BỘ CHẤM ĐIỂM 100 ĐIỂM (CONTENT SEO AGENT V2)

> **Ngày thiết kế**: 2026-11-18
> **Mục tiêu Phase 2**:
> 1. Cung cấp công cụ **Chỉnh sửa nội dung trực quan (Visual Block Editor)** ngay tại Cổng 2 (`preview_review`) và trạng thái `writing` (khi cần con người can thiệp), tự động chạy lại kiểm chứng sự thật (`Truth Guard`) và 6 bài kiểm tra tự động sau mỗi lần lưu.
> 2. Triển khai **Bộ chấm điểm chất lượng 100 điểm (SEO 25 + GEO 25 + AEO 20 + TRUST 15 + UX 15)** bằng code xác định (0 token) tích hợp trực tiếp vào `CheckReport`.

---

## 1. Bộ Chấm Điểm Chất Lượng 100 Điểm (`lib/checks/scorer.ts`)

### 1.1. Cấu Trúc 5 Trụ Cột Điểm Số (Tổng 100 điểm)

| Nhóm tiêu chí | Điểm tối đa | Cách tính điểm xác định bằng code (Deterministic Rubric) |
| :--- | :---: | :--- |
| **A. SEO** | **25** | - `seo.title` đúng độ dài 10–60 ký tự (5đ)<br>- `seo.meta_description` đúng độ dài 30–155 ký tự (5đ)<br>- `primary_keyword` xuất hiện trong `seo.title` (5đ)<br>- `primary_keyword` xuất hiện trong 100 từ đầu tiên (5đ)<br>- Có ít nhất 2 thẻ `h2` và có thẻ `h2` chứa từ khóa/chủ đề (5đ) |
| **B. GEO** | **25** | - Xác định rõ Entity thương hiệu/sản phẩm trong bài (7đ)<br>- Có ít nhất 2 dữ kiện xác thực gắn `fact_ids` hợp lệ từ `brand_profile` (10đ)<br>- Trình bày dữ liệu có cấu trúc dễ trích xuất (`list`, `table`, hoặc `callout`) (8đ) |
| **C. AEO** | **20** | - Direct Answer Pattern: Có đoạn `paragraph` trả lời trực tiếp ngay sau thẻ `h2` (8đ)<br>- Có khối `faq` từ 1–6 câu hỏi và mọi câu trả lời từ 3 đến < 300 từ (8đ)<br>- Sử dụng danh sách (`list`), bảng biểu (`table`) hoặc định nghĩa ngắn gọn (4đ) |
| **D. TRUST** | **15** | - Không chứa bất kỳ `forbidden_claims` nào (5đ)<br>- Mọi số liệu thương hiệu và `fact_ids` khớp 100% `brand_profile` (5đ)<br>- Không còn thông tin thiếu (`needs_info` rỗng) và không có block `NEEDS_VERIFICATION` (5đ) |
| **E. UX & CONVERSION** | **15** | - Mọi đoạn văn dễ đọc, không quá dài (≤ 120 từ/đoạn) (5đ)<br>- Có ít nhất 1 hình ảnh minh họa với `asset_id` hợp lệ và `alt` ≤ 125 ký tự (5đ)<br>- Bố cục đa dạng (kết hợp tiêu đề, đoạn văn, danh sách/bảng/callout và FAQ) (5đ) |

### 1.2. Ngưỡng Đánh Giá & Quy Tắc Chặn Cứng Sự Thật (`Truth Hard Block`)

Theo đúng mục 8 của quy chuẩn **Website Content Standard Agent**:
- **`90–100` (`READY_TO_PUBLISH`)**: Đủ điều kiện đề xuất xuất bản.
- **`80–89` (`MINOR_EDITS`)**: Cần chỉnh sửa một số nội dung.
- **`70–79` (`MAJOR_OPTIMIZATION`)**: Cần tối ưu đáng kể.
- **`< 70` (`REWRITE_REQUIRED`)**: Phải viết lại hoặc nghiên cứu bổ sung.
- **Quy tắc bất khả xâm phạm (`BLOCKED_BY_TRUTH`)**:
  > *"Nếu có lỗi nghiêm trọng về sự thật, nguồn dẫn chứng hoặc thông tin doanh nghiệp, không được thông qua dù tổng điểm cao."*
  Do đó, nếu kiểm tra `brand_facts_and_claims` hoặc `needs_info_empty` bị trượt (`passed === false`), trạng thái chất lượng bắt buộc bị gắn nhãn `BLOCKED_BY_TRUTH` và `CheckReport.passed` luôn là `false` bất kể tổng điểm 4 trụ cột kia đạt bao nhiêu.

---

## 2. Trình Chỉnh Sửa Nội Dung Trực Quan (`VisualBlockEditor`) & Server Action

### 2.1. Thành Phần Giao Diện `components/VisualBlockEditor.tsx`
Component Client (`"use client"`) cho phép Editor/Admin thao tác trực quan trên các khối nội dung:
- Sửa trực tiếp `seo.title` (kèm bộ đếm ký tự `/60`), `seo.meta_description` (bộ đếm `/155`), và `slug`.
- Danh sách các khối `content_blocks`:
  - Hỗ trợ chỉnh sửa trực tiếp tất cả 8 loại block: `h2`, `h3`, `paragraph`, `list`, `table`, `image`, `callout`, `faq`.
  - Cho phép chọn nhãn dữ kiện `claim_label` (`VERIFIED`, `USER_PROVIDED`, `GENERAL_KNOWLEDGE`, `NEEDS_VERIFICATION`, `OPINION`) và chọn/nhập `fact_ids` từ danh sách `brand_profile.facts`.
  - Hỗ trợ **Thêm khối mới**, **Di chuyển lên/xuống**, **Xóa khối**, và chế độ xem/sửa JSON đồng bộ.
  - Tự động tuần tự hóa mảng `content_blocks` vào `<input type="hidden" name="content_blocks_json" />` để gửi qua Server Action chuẩn của Next.js.

### 2.2. Server Action `savePreviewContentAction` (`app/admin/articles/[id]/actions.ts`)
1. Xác thực người dùng và cập nhật `slug`, `seo`, `content_blocks` qua `createServerSupabaseClient()` (tuân thủ RLS và quyền cột của `authenticated`).
2. Chạy `verifyArticleClaimsAndEnforceTruthLabels()` (`Truth Guard`) và `runAllArticleChecks()` (bao gồm cả bộ chấm điểm 100 điểm).
3. Dùng `createAdminSupabaseClient()` cập nhật `checks_passed`, `check_report` và `last_error`.
4. Nếu sau khi sửa mà bài viết vi phạm kiểm tra (`checks_passed === false`), giao diện tại Cổng 2 sẽ vô hiệu hóa nút **"Đăng ngay"** và **"Lên lịch"** cho đến khi Editor sửa đạt chuẩn 6/6 kiểm tra!

