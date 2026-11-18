# Kịch Bản Kiểm Thử Demo Content Agent (`DEMO_TEST_PLAN.md`)

> **Lưu ý quan trọng:** Các kịch bản tương tác trực tiếp với cơ sở dữ liệu và hàng đợi (`A` → `G`) dưới đây cần project **Supabase thật** đã chạy migration `001_content_agent.sql` + `002_worker_rpc.sql` và nạp dữ liệu qua `npm run seed` (xem hướng dẫn từng bước trong `SETUP_CHECKLIST.md`). Các kiểm thử đơn vị tương ứng đã được tự động hóa trong `npm run test` (Vitest).

---

## Kịch bản A — Luồng chuẩn: Chủ đề đủ dữ liệu → Qua 2 cổng → Đăng ngay

### Các bước thực hiện:
1. Đăng nhập tại `/login` bằng tài khoản `admin@demo.test` (hoặc `editor@demo.test`).
2. Vào `/admin/articles`, tại form **Tạo bài viết mới**, nhập:
   - **Chủ đề (`topic`):** `Hướng dẫn pha cà phê espresso với máy LumiBrew Mini X1`
   - **Ngày đăng dự kiến:** chọn ngày bất kỳ.
   - Bấm **"+ Tạo bài viết & đưa vào hàng đợi Agent"**.
3. Trang chuyển tới `/admin/articles/[id]` (trạng thái `outline_draft`, `v1`). Bấm nút **"▶ Chạy tác vụ chờ (Dev Worker)"** ở góc phải trên.
4. **CỔNG 1 (`outline_review`, `v2`):**
   - Kiểm tra `primary_keyword`, `secondary_keywords` (≤ 8), `faq_questions` (≤ 6) và `outline` (các mục H2 có `fact_ids` khớp `fact-01`..`fact-08`, `needs_info` rỗng).
   - Bấm **"✓ Duyệt ý chính (Chuyển sang tải ảnh)"**.
5. **Bước Tải ảnh (`awaiting_images`, `v3`):**
   - Chọn 1 ảnh PNG/JPEG từ máy tính và bấm **"↑ Upload & Tạo bản phân tích JPEG"**.
   - Bấm **"✓ Xong ảnh, phân tích (`analyzing_images`)"**.
6. **Bước Phân tích ảnh (`analyzing_images`, `v4`):**
   - Bấm **"▶ Chạy tác vụ chờ (Dev Worker)"** → Agent phân tích ảnh bằng `model_vision`, lưu `alt_text`/`analysis` và tự chuyển sang `writing` (`v5`).
7. **Bước Viết bài & Kiểm tra tự động (`writing`, `v5`):**
   - Bấm **"▶ Chạy tác vụ chờ (Dev Worker)"** → Agent viết bài (`content_blocks` JSON), chạy 6 kiểm tra tự động (`lib/checks`), đạt 6/6 (`checks_passed = true`), tự chuyển qua `draft_ready` (`v6`) rồi sang **CỔNG 2 (`preview_review`, `v7`)**.
8. **CỔNG 2 (`preview_review`, `v7`):**
   - Xem trước bài viết hiển thị qua `<ArticleRenderer>` và xem trước JSON-LD.
   - Bấm nút **"🚀 Đăng ngay (`published`)"**.

### Kết quả mong đợi:
- Trạng thái bài viết chuyển sang `published` (`v8`), `published_at` được ghi nhận.
- Truy cập `/blog` và `/blog/[slug]` thấy bài viết hiển thị công khai với giao diện giống hệt màn hình Xem trước ở Cổng 2.
- Bảng `article_events` ghi nhận đầy đủ chuỗi chuyển trạng thái kèm `actor_kind` (`agent` và `editor`).

---

## Kịch bản B — Lên lịch: Đặt lịch +2 phút, gọi `/api/publish-due` → Trang công khai hiển thị bài

### Các bước thực hiện:
1. Đưa một bài viết tới **CỔNG 2 (`preview_review`)** (hoặc dùng bài mới thực hiện các bước 1–7 của Kịch bản A).
2. Tại CỔNG 2 (`preview_review`):
   - Chọn ô **Thời điểm lên lịch (tương lai)** = thời điểm hiện tại **+ 2 phút**.
   - Bấm **"📅 Lên lịch (`scheduled`)"**.
3. Kiểm tra `/blog` ngay lúc này: bài viết **chưa** xuất hiện trên trang công khai.
4. Đợi qua mốc 2 phút, sau đó bấm nút **"⏰ Chạy đăng bài đến hạn"** trên `/admin/articles/[id]` (hoặc gọi `POST /api/publish-due` kèm header `x-worker-secret: <AGENT_WORKER_SECRET>`).

### Kết quả mong đợi:
- Hàm SQL `publish_due_articles()` chuyển bài từ `scheduled` sang `published` với `actor_kind = 'system'`, ghi chú `"Đăng theo lịch"`.
- Truy cập `/blog` và `/blog/[slug]` thấy bài viết xuất hiện công khai.

---

## Kịch bản C — Bẫy bịa: Chủ đề `"chính sách bảo hành và đổi trả"` (`brand_profile` không có)

### Các bước thực hiện:
1. Vào `/admin/articles`, tạo bài viết mới với chủ đề:
   `Chính sách bảo hành và đổi trả máy pha cà phê LumiBrew Mini X1`
2. Bấm **"▶ Chạy tác vụ chờ (Dev Worker)"** để chạy `plan_outline`.
3. Quan sát hộp cảnh báo `needs_info` màu vàng tại `outline_review`. Tiếp tục bấm **"✓ Duyệt ý chính"**, tải lên 1 ảnh, bấm **"✓ Xong ảnh, phân tích"**, rồi bấm **"▶ Chạy tác vụ chờ (Dev Worker)"** 2 lần (cho `analyze_images` và `write_article`).

### Kết quả mong đợi:
- Bài viết **KHÔNG** tự nghĩ ra số tháng bảo hành hay điều kiện đổi trả (vì `fixtures/brand.demo.json` cố ý không có thông tin bảo hành/đổi trả).
- Mảng `needs_info` có nội dung ghi rõ thiếu thông tin chính sách bảo hành/đổi trả từ `brand_profile`.
- Hạng mục kiểm tra `needs_info_empty` trong `check_report` báo **CHƯA ĐẠT (`passed: false`)**, `checks_passed = false`.
- Bài viết bị chặn lại ở trạng thái `writing`, **KHÔNG** chuyển sang `preview_review`.

---

## Kịch bản D — Bẫy cấm nói: Yêu cầu nội dung `"rẻ nhất thị trường"` → Bị chặn

### Các bước thực hiện:
1. Tại bước `outline_review` của một bài viết, sửa ô `outline` (hoặc câu hỏi FAQ / tiêu đề) thêm yêu cầu chứa cụm từ `"rẻ nhất thị trường"` (hoặc kiểm tra trực tiếp qua unit test `tests/checks.test.ts` — `Check 4b`).
2. Khi chạy kiểm tra tự động `checkBrandFactsAndForbiddenClaims` ở bước `write_article`:

### Kết quả mong đợi:
- Nếu nội dung sinh ra chứa cụm từ `"rẻ nhất thị trường"` (nằm trong `brand_profile.forbidden_claims`), hạng mục `brand_facts_and_claims` trong `check_report` lập tức báo **CHƯA ĐẠT (`passed: false`)** với thông báo: `Bài viết chứa tuyên bố cấm "rẻ nhất thị trường" [R-18, R-32]`.
- Bài viết bị chặn, không được chuyển sang `preview_review`.

---

## Kịch bản E — Quyền: Editor tự `UPDATE status` bị từ chối; Agent chuyển sang `published` bị từ chối

### Các bước thực hiện:
1. **Kiểm tra chặn sửa cột `status` trực tiếp:**
   - Đăng nhập bằng `editor@demo.test` hoặc mở SQL Editor / Supabase client gọi:
     ```ts
     await supabase.from('articles').update({ status: 'published' }).eq('id', articleId);
     ```
2. **Kiểm tra chặn Agent tự đăng bài (`published` / `scheduled`):**
   - Dùng `service_role` gọi RPC:
     ```sql
     select public.transition_article('<article_id>', 'published', <version>, 'agent', 'Agent tự đăng');
     ```

### Kết quả mong đợi:
- Ở bước 1: Bị chặn bởi cả 2 tầng: quyền cột (`grant update (...) on public.articles` không có cột `status`) và trigger `trg_guard_status` (`Chỉ được đổi trạng thái qua transition_article()`).
- Ở bước 2: Bị hàm `transition_article()` từ chối với lỗi: `Không được chuyển ... -> published với vai trò agent` (vì bảng `article_transitions` chỉ cho phép `editor` hoặc `system` chuyển sang `published`, và chỉ `editor` chuyển sang `scheduled`).

---

## Kịch bản F — Tiết kiệm Token: Resize ảnh 4000px, Cache `sha256`, Hạn mức = 1, Nhật ký `ai_runs`

### Các bước thực hiện:
1. **Resize ảnh 4000px & trùng `sha256`:**
   - Ở bước `awaiting_images`, tải lên một ảnh lớn `4000×3000px`.
   - Tải lại chính ảnh đó lần thứ 2 trong cùng bài viết.
   - Tạo bài viết thứ 2, tải cùng ảnh đó lên và chạy bước `analyze_images`.
2. **Kiểm tra chặn hạn mức = 1:**
   - Đăng nhập bằng `admin@demo.test`, vào `/admin/settings/ai`, đặt **Hạn mức token tháng (`monthly_token_budget`) = `1`**, bấm **Lưu cài đặt AI**.
   - Bấm nút **"Kiểm tra kết nối"** (hoặc bấm **"▶ Chạy tác vụ chờ"**).

### Kết quả mong đợi:
- Ảnh `4000×3000px` được `sharp` tạo bản phân tích JPEG có cạnh dài `1568px` (`<= IMAGE_MAX_EDGE`) lưu tại `analysis_path`.
- Lần tải thứ 2 trong cùng bài báo: `"Ảnh trùng mã băm sha256 ... trong cùng bài viết — đã bỏ qua"`.
- Ở bài viết thứ 2, bước `analyze_images` phát hiện `sha256` đã có kết quả phân tích nên tái sử dụng ngay (`0 token`, không gọi lại model Vision).
- Khi đặt hạn mức = `1`, mọi lệnh gọi AI đều bị chặn ngay trước khi gọi mạng với thông báo: `"Đã chạm hạn mức token tháng (.../1 token). Tác vụ AI bị chặn."`
- Bảng `ai_runs` tại `/admin/settings/ai` ghi nhận đầy đủ từng lần gọi AI (`step`, `model`, `input_tokens`, `output_tokens`, `cost_usd`).

---

## Kịch bản G — Schema: `Article` / `FAQPage` / `BreadcrumbList` hợp lệ và khớp nội dung hiển thị

### Các bước thực hiện:
1. Mở một bài viết đã xuất bản tại `/blog/[slug]` (hoặc mở phần **Xem JSON-LD Schema do code dựng** tại Cổng 2 `/admin/articles/[id]`).
2. View Page Source của `/blog/[slug]`, tìm thẻ `<script type="application/ld+json">`.

### Kết quả mong đợi:
- JSON-LD được dựng hoàn toàn bằng code (`lib/seo/schema.ts`), chứa `@context: "https://schema.org"` và `@graph` gồm 3 phần tử:
  1. `Article` (đủ `headline` ≤ 110 ký tự, `description`, `author`, `datePublished`, `dateModified` chuẩn ISO 8601, `mainEntityOfPage`).
  2. `BreadcrumbList` (3 phần tử `ListItem` với `position` 1, 2, 3 và `item` là URL tuyệt đối).
  3. `FAQPage` (`mainEntity` chứa danh sách `Question`/`Answer` khớp từng chữ với các khối FAQ hiển thị trên trang bài viết).

