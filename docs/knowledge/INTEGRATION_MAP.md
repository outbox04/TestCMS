# Bản Đồ Tích Hợp Hệ Thống (`INTEGRATION_MAP.md`)

Tài liệu này ánh xạ các quy tắc rút ra từ 10 repository nguồn (`R-01` → `R-42`) vào kiến trúc 5 bước + 2 cổng duyệt + trang đọc công khai của hệ thống Content SEO Agent (Next.js + Supabase + TypeScript).

---

## (a) Bảng Nối: Bước Quy Trình → Repo Nguồn → Quy Tắc → Module Code → File Test

| Bước của quy trình | Repo nguồn | ID quy tắc (`R-xx`) | Module code sẽ cài | File test kiểm chứng |
|---|---|---|---|---|
| **Bước 1: Lập kế hoạch & Gom cụm từ khóa (`plan`)** | `chukhraiartur/seo-keyword-research-tool`<br>`every-app/open-seo`<br>`DesignupADM/SEO-AI-Skills`<br>`indranilbanerjee/contentforge` | `R-01`, `R-02`, `R-03`, `R-04`, `R-05`, `R-06`, `R-07`, `R-08`, `R-09` | `src/lib/seo/keyword-planner.ts`<br>`src/lib/seo/keyword-clustering.ts`<br>`src/lib/agents/plan-agent.ts` | `tests/unit/keyword-planner.test.ts`<br>`tests/unit/keyword-clustering.test.ts` |
| **Bước 2: Phân tích hình ảnh & Tối ưu thị giác (`image`)** | `Pritom14/token0`<br>`anthropics/claude-cookbooks`<br>`DesignupADM/SEO-AI-Skills` | `R-10`, `R-11`, `R-12`, `R-13`, `R-14`, `R-15`, `R-16`, `R-17` | `src/lib/vision/image-optimizer.ts`<br>`src/lib/vision/vision-cache.ts`<br>`src/lib/agents/image-analyzer.ts` | `tests/unit/image-optimizer.test.ts`<br>`tests/unit/vision-cache.test.ts` |
| **Bước 3: Viết bài chuẩn SEO / AEO / GEO & Hồ sơ thương hiệu (`write`)** | `indranilbanerjee/contentforge`<br>`thatrebeccarae/claude-marketing`<br>`DesignupADM/SEO-AI-Skills`<br>`anthropics/claude-cookbooks` | `R-16`, `R-18`, `R-19`, `R-20`, `R-21`, `R-22`, `R-23`, `R-24` | `src/lib/brand/brand-profile.ts`<br>`src/lib/content/blocks-schema.ts`<br>`src/lib/agents/writer-agent.ts` | `tests/unit/writer-rules.test.ts`<br>`tests/unit/blocks-schema.test.ts` |
| **Bước 4: Dựng & Kiểm tra JSON-LD Schema (`schema`)** | `sickn33/agentic-awesome-skills`<br>`psyduckler/aeo-skills`<br>`DesignupADM/SEO-AI-Skills` | `R-25`, `R-26`, `R-27`, `R-28`, `R-29` | `src/lib/schema/jsonld-builder.ts`<br>`src/lib/schema/jsonld-validator.ts` | `tests/unit/jsonld-builder.test.ts`<br>`tests/unit/jsonld-validator.test.ts` |
| **Bước 5: Chống bịa đặt & Kiểm tra chất lượng tự động (`check`)** | `indranilbanerjee/contentforge`<br>`DesignupADM/SEO-AI-Skills`<br>`sickn33/agentic-awesome-skills` | `R-09`, `R-17`, `R-18`, `R-19`, `R-26`, `R-28`, `R-29`, `R-30`, `R-31`, `R-32`, `R-33` | `src/lib/check/fact-checker.ts`<br>`src/lib/check/seo-aeo-scorer.ts`<br>`src/lib/security/untrusted-content.ts` | `tests/unit/fact-checker.test.ts`<br>`tests/unit/seo-aeo-scorer.test.ts` |
| **Cổng duyệt 1 & 2, Đổi trạng thái & Lịch đăng (`gate`)** | `indranilbanerjee/contentforge`<br>`rickwalking/alter-ego` | `R-34`, `R-35`, `R-36`, `R-37`, `R-38` | `src/lib/workflow/quality-gate.ts`<br>`src/lib/workflow/transition-article.ts`<br>`supabase/migrations/*_transition_article.sql` | `tests/unit/quality-gate.test.ts`<br>`tests/unit/transition-article.test.ts` |
| **Trang đọc công khai, Metadata & Bảo mật (`site`)** | `thatrebeccarae/claude-marketing`<br>`indranilbanerjee/contentforge`<br>`DesignupADM/SEO-AI-Skills`<br>`rickwalking/alter-ego` | `R-17`, `R-20`, `R-23`, `R-30`, `R-38`, `R-39`, `R-40`, `R-41`, `R-42` | `src/app/articles/[slug]/page.tsx`<br>`src/app/robots.ts`<br>`src/app/sitemap.ts`<br>`src/lib/config/env.ts` | `tests/unit/public-site-seo.test.ts`<br>`tests/unit/security-env.test.ts` |

---

## (b) Danh Sách Phần Bị Loại Bỏ & Lý Do

Theo quy tắc mục 1.3, các tính năng/quy trình sau trong các repo gốc bị loại bỏ vì không phù hợp với kiến trúc Demo Content SEO Agent (Next.js + Supabase, lưu `content_blocks` JSON, quy trình 5 bước, 2 cổng duyệt):

1. **Xuất file `.docx` kèm 4 phụ lục (`generate-docx.py`)** trong `indranilbanerjee/contentforge`:
   - *Lý do*: Hệ thống của chúng ta lưu trữ trực tiếp bài viết dưới dạng `content_blocks` JSON trong PostgreSQL (Supabase) và hiển thị trực tiếp trên giao diện biên tập + trang đọc công khai Next.js, không giao nhận qua tệp Word `.docx`.
2. **Đồng bộ & lưu trữ trên Google Drive / Google Sheets / Airtable / Cowork Sandbox (`detect-drive-mcp.py`, `sheets-tracker.py`, `drive-uploader.py`)** trong `indranilbanerjee/contentforge`:
   - *Lý do*: Toàn bộ dữ liệu dự án, hồ sơ thương hiệu, điểm chất lượng và lịch sử duyệt bài được quản lý tập trung trong cơ sở dữ liệu Supabase.
3. **Các quy định ngành đặc thù nghiêm ngặt (Pharma FDA, HIPAA y tế, BFSI SEC/FTC, Legal) và ngưỡng điểm riêng theo ngành** trong `indranilbanerjee/contentforge`:
   - *Lý do*: Demo tập trung vào luồng chuẩn chung (`Default`: điểm duyệt ≥ 7.0, nguồn dẫn ≤ 2 năm), không triển khai gói luật dược phẩm hay tài chính chuyên biệt.
4. **Theo dõi thương hiệu định kỳ trên các nền tảng AI bên thứ ba (Profound, Otterly, Conductor AgentStack, HubSpot AEO, khảo sát thủ công hàng tháng 20 truy vấn trên ChatGPT/Perplexity)** trong `thatrebeccarae/claude-marketing` và `indranilbanerjee/contentforge`:
   - *Lý do*: Nằm ngoài phạm vi tạo và kiểm duyệt bài viết của Content Agent; hệ thống chỉ đánh giá các tín hiệu nội tại có thể kiểm chứng ngay trên bài viết và trang xuất bản.
5. **Tối ưu hóa luồng Video (trích xuất keyframe 1fps, QJL fuzzy perceptual hash, CLIP frame scoring) và Accessibility Tree Routing cho tác nhân điều khiển UI (`AXUIElement`/Playwright)** trong `Pritom14/token0`:
   - *Lý do*: Bước phân tích ảnh của bài viết SEO chỉ xử lý ảnh tĩnh (ảnh sản phẩm, ảnh chụp màn hình, biểu đồ minh họa) để sinh mô tả, `alt`, `caption` và dữ liệu bài viết, không xử lý luồng video hay điều khiển trình duyệt bằng cây trợ năng.
6. **Quy trình làm Carousel 7 bước (LangGraph + Redis Streams + Pinecone + Langfuse)** trong `rickwalking/alter-ego`:
   - *Lý do*: Chỉ học luồng trạng thái biên tập bài blog (`draft` → `review` → `approved` → `scheduled` → `published`), kiểm tra chất lượng và lịch sử phiên bản; không sao chép mã nguồn hay kiến trúc FastAPI/Pinecone/Carousel của `alter-ego`.
7. **Quảng cáo trả phí (Google Ads campain setup, ChatGPT Ads)** được nhắc tới trong `DesignupADM/SEO-AI-Skills` và `indranilbanerjee/contentforge`:
   - *Lý do*: Chỉ dùng số liệu từ khóa ở chế độ chỉ đọc (nếu có), không chạy hay quản lý chiến dịch quảng cáo.
8. **Thị trường/công cụ tìm kiếm đặc thù địa phương ngoài phạm vi (Naver/Hàn Quốc)** hoặc các công cụ local-pack bản đồ chuyên biệt khi bài viết không phải Local SEO:
   - *Lý do*: Không thuộc phạm vi bài viết nội dung chuẩn của hệ thống.

---

## (c) Mâu Thuẫn Giữa Các Repo & Quyết Định Giải Quyết

Các mâu thuẫn phát hiện trong quá trình đối chiếu 10 repo được giải quyết theo đúng thứ tự ưu tiên: **(1) Yêu cầu đề bài & Phụ lục A** → **(2) Quy tắc xuất hiện ở ≥ 2 repo** → **(3) Commit mới hơn**.

### Mâu thuẫn 1: Vai trò và hiệu lực của `FAQPage` và `HowTo` Schema đối với SEO / AI Search (AEO/GEO)
- **Nguồn mâu thuẫn**:
  - `psyduckler/aeo-skills` (`aeo-schema/SKILL.md`, commit `5423d43`) và `thatrebeccarae/claude-marketing` (`skills/aeo-geo-optimizer/REFERENCE.md`, commit `a8a63ec`) xem `FAQPage` và `HowTo` là các loại Schema có ROI cao nhất giúp AI trích xuất câu trả lời và hiển thị nổi bật.
  - Ngược lại, `indranilbanerjee/contentforge` (`agents/06-seo-geo-optimizer.md`, commit `8c16243`), `DesignupADM/SEO-AI-Skills` (`references/modern-seo-standards.md`, commit `3d04da6`) và `sickn33/agentic-awesome-skills` (`skills/seo-aeo-schema-generator/SKILL.md`, commit `15888d3`) chỉ rõ: Google đã ngừng hỗ trợ HowTo rich results (từ 09/2023) và giới hạn/loại bỏ FAQ rich results cho các trang thông thường; không có cam kết chính thức nào từ Google rằng `FAQPage`/`HowTo` đảm bảo được trích dẫn trong AI Overviews.
- **Quyết định**:
  - Luôn sinh `Article` + `BreadcrumbList` (kèm `Person`/`Organization`) làm nền tảng bắt buộc cho mọi bài viết (`R-27`, `R-28`).
  - Vẫn hỗ trợ sinh thêm `FAQPage` (hoặc `HowTo`) bằng code trong khối `@graph` **NHƯNG chỉ khi và chỉ khi** trong `content_blocks` của bài viết thực sự có khối FAQ (câu hỏi - câu trả lời hiển thị) hoặc các bước hướng dẫn tương ứng (`R-26`, `R-27`, `R-29`). Không ép mọi bài viết phải có `FAQPage`/`HowTo` và không tuyên bố Schema này đảm bảo lên Google Rich Results.
- **Lý do**: Ưu tiên (1) Yêu cầu đề bài cần bộ dựng và kiểm tra JSON-LD hỗ trợ chồng lớp (`Article`, `FAQPage`, `BreadcrumbList`) từ `content_blocks` và (2) Quy tắc đồng thuận ở ≥ 3 repo (`contentforge`, `SEO-AI-Skills`, `agentic-awesome-skills`) rằng chỉ đánh dấu những gì hiển thị thực tế trên trang.

### Mâu thuẫn 2: Mức độ cần thiết của tệp `llms.txt` và định dạng chia nhỏ nội dung (chunking) cho AI
- **Nguồn mâu thuẫn**:
  - Một số hướng dẫn AEO cộng đồng thường khuyến nghị tạo `llms.txt` và cắt nhỏ bài viết cho LLM đọc.
  - Tuy nhiên, cả `indranilbanerjee/contentforge` (`agents/06-seo-geo-optimizer.md` dẫn tài liệu Google Search cập nhật) và `DesignupADM/SEO-AI-Skills` (`references/modern-seo-standards.md`, `references/article-creation-workflow.md`) đều khẳng định rõ: Google Search bỏ qua `llms.txt`, không có định dạng đánh dấu đặc biệt nào cho AI Search, và không được cắt vụn bài viết thành các mảnh nhân tạo làm giảm chất lượng đọc của con người.
- **Quyết định**:
  - Không đưa `llms.txt` vào tiêu chí chấm điểm cổng chất lượng hay yêu cầu bắt buộc của site (`R-40`).
  - Tập trung vào cấu trúc HTML/block ngữ nghĩa rõ ràng (câu trả lời trực tiếp ngay sau H2, bảng biểu, danh sách, số liệu có nguồn) và cấu hình `robots.txt` cho phép AI crawlers hợp lệ (`R-21`, `R-22`, `R-39`).
- **Lý do**: Ưu tiên (2) Đồng thuận giữa ≥ 2 repo (`contentforge` và `SEO-AI-Skills`) dựa trên tài liệu chính thức của Google Search.

### Mâu thuẫn 3: Mật độ từ khóa (Keyword Density) và độ dài bài viết (Word Count) là cổng chặn cứng hay chỉ tham khảo
- **Nguồn mâu thuẫn**:
  - Trong `indranilbanerjee/contentforge` (`docs/QUALITY-CONTRACT.md`), cổng chất lượng 3 kiểm tra số lượng từ trong khoảng `±10%` mục tiêu (`word_count_tolerance_percent`), trong khi ở cổng 6 (`agents/06-seo-geo-optimizer.md`), mật độ từ khóa `1–2%` chỉ là chỉ số tham khảo (`advisory`), còn **vị trí đặt từ khóa** (Title/H1, 100 từ đầu, ≥ 2 H2, kết bài, meta description) mới là điều kiện qua cổng.
  - Trong `DesignupADM/SEO-AI-Skills` (`references/article-creation-workflow.md`, `SKILL.md`), quy tắc yêu cầu không nhồi nhét từ khóa theo mật độ cơ học và không kéo dài bài viết vô ích (do not pad to a target length) chỉ để đủ số từ; độ dài tiêu đề/mô tả là quy tắc biên tập hướng dẫn.
- **Quyết định**:
  - Kiểm tra **vị trí xuất hiện của từ khóa chính** (5 vị trí trọng yếu) và giới hạn ký tự `meta_title` (≤ 60), `meta_description` (≤ 155) trong bộ chấm điểm SEO (`R-19`, `R-20`).
  - Mật độ từ khóa (`1–2%`) chỉ ghi nhận làm thông tin cảnh báo (advisory), tuyệt đối không bắt Agent chèn thêm từ khóa cơ học để đạt phần trăm (`R-19`). Không bắt lỗi cứng `±10%` số từ nếu bài viết đã trả lời trọn vẹn các mục trong dàn ý mà không lan man (`R-24`).
- **Lý do**: Ưu tiên (2) Cả `contentforge` và `SEO-AI-Skills` đều đồng thuận chống nhồi nhét từ khóa theo mật độ và ưu tiên chất lượng trả lời tự nhiên.

### Mâu thuẫn 4: Giới hạn độ dài `headline` trong Article Schema (≤ 110 ký tự) so với `meta_title` / `H1` (≤ 60–70 ký tự)
- **Nguồn mâu thuẫn**:
  - `indranilbanerjee/contentforge` (`agents/06-seo-geo-optimizer.md`) và `thatrebeccarae/claude-marketing` (`skills/aeo-geo-optimizer/REFERENCE.md`) quy định `meta_title` ≤ 60 ký tự (và H1 bài viết từ 40–70 ký tự).
  - `psyduckler/aeo-skills` (`aeo-schema/SKILL.md` và `references/schema-templates.md`) quy định trường `headline` trong JSON-LD `Article` khớp với H1 và giới hạn `≤ 110 ký tự`.
- **Quyết định**:
  - Ở tầng SEO Metadata (`seo.meta_title`), áp dụng giới hạn chặt `≤ 60 ký tự` (`R-20`).
  - Ở tầng kiểm tra JSON-LD Schema (`Article.headline`), cho phép độ dài tối đa `≤ 110 ký tự` theo đúng chuẩn Schema.org/Google Article (`R-28`), vì khi `H1`/`meta_title` đạt chuẩn ≤ 60–70 ký tự thì tự động thỏa mãn điều kiện ≤ 110 ký tự của `Article.headline`.
- **Lý do**: Hai quy tắc áp dụng cho hai tầng dữ liệu khác nhau (hiển thị SERP title tag vs thuộc tính `headline` của JSON-LD) nên bổ trợ cho nhau mà không xung đột khi thực thi.

### Mâu thuẫn 5: Quyền tự động xuất bản (Auto-Approve / MCP Agent Publish) so với Cổng duyệt con người bắt buộc
- **Nguồn mâu thuẫn**:
  - `indranilbanerjee/contentforge` (`config/brand-registry-template.json`) có trường `auto_approve_threshold: 8.5`, và `rickwalking/alter-ego` (`research/blog_editorial_workflows_report.md`) có nhắc tới tính năng WordPress MCP cho phép AI Agent tự tạo, lên lịch (`schedule`) và xuất bản bài viết.
  - Tuy nhiên, tài liệu hướng dẫn chính của `rickwalking/alter-ego` (`docs/guides/editorial-workflow-user-guide.md`) áp dụng cổng duyệt con người (`human-in-the-loop review gates`), và **yêu cầu đề bài (Ưu tiên 1)** khóa cứng: Agent không bao giờ được tự chuyển bài sang `scheduled` hoặc `published`, mọi thay đổi trạng thái phải đi qua `transition_article()`.
- **Quyết định**:
  - Khóa hoàn toàn quyền của Agent ở mức tạo nháp (`draft`) và gửi duyệt (`under_review` / `pending_review`). Chỉ người duyệt (human reviewer/editor) sau khi qua Cổng duyệt 2 mới được phép gọi `transition_article()` để chuyển bài sang `approved`, `scheduled` hoặc `published` (`R-36`, `R-37`).
- **Lý do**: Ưu tiên (1) Quy tắc bất khả xâm phạm của đề bài và kiến trúc 2 cổng duyệt.

### Mâu thuẫn 6: Kích thước thu nhỏ ảnh cho Claude Vision (1568px vs 2576px) và định tuyến OCR thay ảnh
- **Nguồn mâu thuẫn**:
  - `Pritom14/token0` (`README.md`) nêu Claude có 2 bậc kích thước xử lý nội bộ (1568px cho các dòng chuẩn và 2576px cho dòng高-res mới, nhưng với prompt mô tả/phân loại thông thường vẫn thu về bậc chuẩn 1568px để tiết kiệm ~3x token) và có cơ chế thay ảnh bằng văn bản EasyOCR. Tuy nhiên, chính `token0` cũng chỉ ra EasyOCR làm hỏng URL/email trên ảnh chụp giao diện (ví dụ mất dấu chấm hoặc `://`).
- **Quyết định**:
  - Chuẩn hóa bước tiền xử lý ảnh: luôn resize ảnh sao cho cạnh dài nhất `≤ 1568px` (giữ nguyên tỷ lệ khung hình), nén sang JPEG/WebP hợp lý và tính mã băm `sha256` để lưu cache kết quả phân tích (`R-10`, `R-11`, `R-13`). Không dùng EasyOCR thay thế ảnh gửi lên Vision LLM để tránh sai lệch URL/số liệu trong biểu đồ và ảnh chụp màn hình.
- **Lý do**: Ưu tiên (1) Yêu cầu đề bài (resize cạnh dài ≤ 1568px, cache theo `sha256`) và bằng chứng thực nghiệm ngay trong `Pritom14/token0` về rủi ro lỗi OCR trên URL/UI.
