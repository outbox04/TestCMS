# Content Agent Demo (Next.js + Supabase)

Website demo kiểm chứng module **Content Agent** (quy trình 5 bước, 2 cổng duyệt con người) trước khi tích hợp vào CMS thật. Hệ thống chứng minh 4 mục tiêu cốt lõi:
1. **Không bịa thông tin:** Mọi khẳng định/số liệu bắt buộc đối chiếu với `brand_profile` (`facts`, `products`), chặn `forbidden_claims`, thông tin thiếu đẩy vào `needs_info` (`R-18`, `R-31`, `R-32`).
2. **Đạt chuẩn SEO/GEO/AEO:** Kiểm tra tự động bằng code (`lib/checks`), dựng JSON-LD (`Article`, `BreadcrumbList`, `FAQPage`) bằng code (`lib/seo/schema.ts`), cung cấp `/robots.txt` và `/llms.txt`.
3. **Tiết kiệm token:** Chỉ nạp quy tắc theo đúng thẻ bước `loadRules(step)` (`lib/knowledge/rules.ts`), bật Prompt Caching cho phần đầu cố định (`R-16`), dùng `sharp` resize ảnh về cạnh dài `≤ 1568px` JPEG (`R-10`, `R-11`) và cache kết quả phân tích ảnh theo `sha256` (`R-13`).
4. **Agent không tự đăng bài:** Mọi thay đổi trạng thái bắt buộc đi qua hàm SQL `transition_article()`; Agent bị khóa quyền không bao giờ chuyển được sang `scheduled` hoặc `published` (`R-37`).

## Lệnh chạy chính

```bash
npm run typecheck   # Kiểm tra kiểu TypeScript strict (tsc --noEmit)
npm run test        # Chạy toàn bộ unit test & compliance test (vitest run)
npm run build       # Build production Next.js
npm run seed        # Nạp tài khoản mẫu & brand_profile (tsx --env-file=.env.local scripts/seed.ts)
npm run dev         # Chạy server phát triển tại http://localhost:3000
```

## Tài liệu quan trọng
- [`SETUP_CHECKLIST.md`](./SETUP_CHECKLIST.md): Hướng dẫn từng bước tạo Supabase, chạy migration `001` & `002`, điền `.env.local`, chạy `seed` và cấu hình API key.
- [`docs/DEMO_TEST_PLAN.md`](./docs/DEMO_TEST_PLAN.md): Kịch bản kiểm thử A–G kèm các bước bấm và kết quả mong đợi.
- [`docs/knowledge/RULES.md`](./docs/knowledge/RULES.md): Bộ 42 quy tắc (`R-01` → `R-42`) rút ra từ 11 repo tham chiếu.
- [`docs/knowledge/INTEGRATION_MAP.md`](./docs/knowledge/INTEGRATION_MAP.md): Bản đồ tích hợp quy tắc vào code/test và giải quyết mâu thuẫn.
- [`docs/knowledge/COMPLIANCE.md`](./docs/knowledge/COMPLIANCE.md): Bảng ánh xạ từng quy tắc sang file/hàm thực thi (được kiểm tra tự động bởi `tests/compliance.test.ts`).
