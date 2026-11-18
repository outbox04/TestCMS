# Danh Mục Cài Đặt Dành Cho Con Người (`SETUP_CHECKLIST.md`)

Tài liệu này liệt kê các bước thiết lập hạ tầng Supabase và môi trường chạy mà con người thực hiện (Agent tuyệt đối không tự chạy `supabase login`, `link`, `db push` hay ghi vào `.env.local`).

> **Lưu ý:** Các kiểm thử tự động không cần mạng (`npm run typecheck`, `npm run test`, `npm run build`) chạy độc lập ngay trên máy. Tuy nhiên, để chạy tương tác đầy đủ **Kịch bản A–G** trong `docs/DEMO_TEST_PLAN.md` trên trình duyệt, bạn cần hoàn tất các bước Supabase thật dưới đây.

---

## Bước 1 — Tạo Project Supabase nháp & Bật 4 Extensions
1. Truy cập [Supabase Dashboard](https://supabase.com/dashboard) và tạo một project nháp mới.
2. Vào **Database → Extensions**, tìm và bật đủ **4 extension** sau:
   - [ ] `supabase_vault` (Vault lưu trữ bí mật API key)
   - [ ] `pgmq` (Postgres Message Queue cho hàng đợi `agent_jobs`)
   - [ ] `pg_cron` (Lập lịch chạy tự động)
   - [ ] `pg_net` (Gọi HTTP webhook từ Postgres)

---

## Bước 2 — Chạy Migration SQL theo đúng thứ tự
Mở **SQL Editor** trong Supabase Dashboard:
1. [ ] Copy toàn bộ nội dung file [`supabase/migrations/001_content_agent.sql`](file:///d:/Marketing/AI_Video_Studio_Windows_v2/AI%20Agent%20Content%20SEO/supabase/migrations/001_content_agent.sql) (452 dòng) dán vào SQL Editor và bấm **Run**.
2. [ ] Copy toàn bộ nội dung file [`supabase/migrations/002_worker_rpc.sql`](file:///d:/Marketing/AI_Video_Studio_Windows_v2/AI%20Agent%20Content%20SEO/supabase/migrations/002_worker_rpc.sql) dán vào SQL Editor và bấm **Run**.
3. [ ] Kiểm tra **Storage → Buckets**: xác nhận bucket `article-images` (private) đã được tạo bởi migration `001` (nếu chưa có thì tạo bucket tên `article-images`).

---

## Bước 3 — Tạo và điền file `.env.local`
1. Sao chép `.env.example` thành `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. Điền đầy đủ các giá trị vào `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`: URL project Supabase của bạn (Project Settings → API).
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: khóa `anon` / `public` (Project Settings → API).
   - `SUPABASE_SERVICE_ROLE_KEY`: khóa `service_role` (chỉ dùng ở server, tuyệt đối không lộ ra client).
   - `AGENT_WORKER_SECRET`: chuỗi bí mật tự chọn (ví dụ: `demo-worker-secret-2026`).
   - `SEED_PASSWORD`: mật khẩu cho 2 tài khoản demo `admin@demo.test` và `editor@demo.test` (ví dụ: `DemoPass123!`).
   - `SITE_URL`: `http://localhost:3000`
   - `KEYWORD_PROVIDER`: `mock` (mặc định) hoặc `autocomplete`.

---

## Bước 4 — Nạp dữ liệu mẫu (`seed`) & Khởi động ứng dụng
1. Chạy lệnh seed để tạo `admin@demo.test`, `editor@demo.test`, bảng `profiles`, và nạp `brand_profile` từ `fixtures/brand.demo.json`:
   ```bash
   npm run seed
   ```
2. Khởi động server phát triển:
   ```bash
   npm run dev
   ```

---

## Bước 5 — Thiết lập API Key và Model trong giao diện Admin
1. Mở `http://localhost:3000/login`, đăng nhập với `admin@demo.test` và mật khẩu `SEED_PASSWORD`.
2. Truy cập `/admin/settings/ai`:
   - Chọn **Nhà cung cấp AI** (`anthropic` hoặc `openai`).
   - Nhập tên **Model viết bài** (`model_writer`, ví dụ: `claude-sonnet-4-20250514` hoặc `gpt-4o`).
   - Nhập tên **Model phân tích ảnh** (`model_vision`, ví dụ: `claude-3-5-haiku-latest` hoặc `gpt-4o-mini`).
   - Nhập **API Key** vào ô mật khẩu và bấm **Lưu cài đặt AI** (key sẽ được mã hóa vào `vault.secrets`, giao diện chỉ hiện 4 ký tự cuối).
   - Bấm **"Kiểm tra kết nối"** để xác nhận gọi AI thành công.
3. Mở [`docs/DEMO_TEST_PLAN.md`](file:///d:/Marketing/AI_Video_Studio_Windows_v2/AI%20Agent%20Content%20SEO/docs/DEMO_TEST_PLAN.md) để thực hiện lần lượt các kịch bản kiểm thử **A → G**.

