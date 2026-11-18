# CLAUDE.md — Hướng Dẫn Kiến Trúc & Quy Tắc Dự Án Content SEO Agent

## 1. Công Nghệ Sử Dụng (Tech Stack)
- **Framework**: Next.js (App Router), React 19, TypeScript (strict mode), Tailwind CSS.
- **Cơ sở dữ liệu & Backend**: Supabase (PostgreSQL, RLS, RPC Functions, Supabase Vault).
- **Kiểm thử & Chất lượng mã**: Vitest (unit/integration test), TypeScript (`tsc --noEmit`).
- **Tài liệu Next.js**: Luôn tra cứu `node_modules/next/dist/docs/` theo hướng dẫn trong `AGENTS.md` trước khi viết code Next.js.

## 2. Lệnh Chạy Thường Dùng
- `npm run dev` — Khởi chạy máy chủ phát triển Next.js.
- `npm run typecheck` — Kiểm tra kiểu tĩnh TypeScript toàn dự án.
- `npm run test` — Chạy toàn bộ bộ kiểm thử tự động (Vitest).
- `npm run seed` — Khởi tạo dữ liệu mẫu (hồ sơ thương hiệu, từ khóa, bài viết mẫu) vào Supabase.

## 3. Các Quyết Định Kiến Trúc Đã Khóa (BẮT BUỘC TUÂN THỦ)
1. **Quy trình 5 bước & 2 cổng duyệt**:
   - 5 bước: (1) Lập kế hoạch & gom cụm từ khóa (`plan`) → (2) Phân tích & tối ưu ảnh (`image`) → (3) Viết bài theo khối (`write`) → (4) Dựng & kiểm tra JSON-LD (`schema`) → (5) Kiểm chứng sự thật & chấm điểm (`check`).
   - 2 cổng duyệt con người (`gate`): Duyệt dàn ý/kế hoạch (Gate 1) và Duyệt bài hoàn chỉnh trước khi lên lịch/xuất bản (Gate 2).
2. **Khóa quyền chuyển trạng thái của Agent**:
   - Agent **TUYỆT ĐỐI KHÔNG** được tự chuyển trạng thái bài viết sang `scheduled` hoặc `published`.
   - Mọi thao tác đổi `status` của bài viết bắt buộc phải gọi qua hàm RPC `transition_article()` trong cơ sở dữ liệu (có kiểm tra vai trò người gọi và ghi `audit_log`).
3. **Lưu trữ bài viết dạng Block JSON (`content_blocks`)**:
   - Nội dung bài viết không lưu dạng chuỗi HTML/Markdown thô mà bắt buộc lưu dưới dạng mảng JSON có cấu trúc (`content_blocks`: heading, paragraph, list, table, faq, image, callout) kèm đối tượng `seo` và `citations`.
4. **JSON-LD do code dựng xác định (Deterministic Builder)**:
   - Tuyệt đối không để LLM tự viết chuỗi JSON-LD tự do khi hiển thị. JSON-LD (`Article`, `BreadcrumbList`, `FAQPage`) phải do code TypeScript dựng trực tiếp từ `content_blocks`, `seo` và `author_profiles`, đồng thời escape `<` thành `\u003c`.
5. **Tối ưu ảnh & Lưu đệm Vision**:
   - Ảnh đưa vào phân tích thị giác phải được resize cạnh dài `≤ 1568px` và lưu cache kết quả phân tích theo mã băm `sha256`.
6. **Bảo mật khóa API & Cấu hình Model động**:
   - Khóa API (Anthropic/OpenAI/Gemini/SerpApi) chỉ được phép nằm ở phía server hoặc Supabase Vault; tuyệt đối không lộ qua biến `NEXT_PUBLIC_*`.
   - Không viết cứng (hardcode) tên model AI trong mã nguồn; phải đọc qua biến môi trường hoặc cấu hình hệ thống.
7. **Ngôn ngữ giao diện**:
   - Toàn bộ giao diện người dùng (UI), nhãn trạng thái, thông báo lỗi và báo cáo kiểm duyệt hiển thị bằng **tiếng Việt**.

## 4. Con Trỏ Tri Thức Hệ Thống (`docs/knowledge/`)
Trước khi thiết kế schema, viết logic cho Agent hay tạo bài kiểm thử, hãy đọc bộ tài liệu tri thức đã tổng hợp tại:
- [`docs/knowledge/RULES.md`](docs/knowledge/RULES.md) — Danh sách 42 quy tắc (`R-01` → `R-42`) gắn thẻ theo từng bước (`plan`, `image`, `write`, `schema`, `check`, `gate`, `site`).
- [`docs/knowledge/SOURCES.md`](docs/knowledge/SOURCES.md) — Nguồn gốc 11 repository, commit hash và các tệp tài liệu đã đối chiếu.
- [`docs/knowledge/INTEGRATION_MAP.md`](docs/knowledge/INTEGRATION_MAP.md) — Bản đồ nối quy tắc vào module code, file test, các phần đã loại bỏ và cách giải quyết 6 mâu thuẫn giữa các nguồn.
- [`docs/knowledge/COMPLIANCE.md`](docs/knowledge/COMPLIANCE.md) — Bảng theo dõi trạng thái thực thi của từng quy tắc `R-01` → `R-42`.
