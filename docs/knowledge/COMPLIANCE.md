# Báo Cáo Tuân Thủ Quy Tắc Hệ Thống (COMPLIANCE)

Bảng dưới đây ánh xạ đầy đủ từng mã quy tắc (`R-01` → `R-42`) trong `docs/knowledge/RULES.md` tới file và hàm thực thi thực tế trong dự án. Kiểm định tự động bởi `tests/compliance.test.ts`.

| ID | Thẻ bước | File thực thi | Hàm / Thành phần thực thi | Trạng thái |
|---|---|---|---|---|
| `R-01` | `plan` | `lib/keywords/provider.ts` | `deduplicateAndCapKeywords` | Đã cài đặt |
| `R-02` | `plan` | `lib/keywords/provider.ts` | `createKeywordProvider` | Đã cài đặt |
| `R-03` | `plan` | `lib/keywords/provider.ts` | `createKeywordProvider` | Đã cài đặt |
| `R-04` | `plan` | `lib/keywords/provider.ts` | `clusterKeywordsByIntent` | Đã cài đặt |
| `R-05` | `plan` | `lib/keywords/provider.ts` | `clusterKeywordsByIntent` | Đã cài đặt |
| `R-06` | `plan` | `lib/keywords/provider.ts` | `clusterKeywordsByIntent` | Đã cài đặt |
| `R-07` | `plan` | `lib/keywords/provider.ts` | `deduplicateAndCapKeywords` | Đã cài đặt |
| `R-08` | `plan` | `lib/checks/index.ts` | `checkStructureH2AndFaq` | Đã cài đặt |
| `R-09` | `plan,check` | `lib/agent/worker.ts` | `processNextAgentJob` | Đã cài đặt |
| `R-10` | `image` | `lib/images/processor.ts` | `processImageForAnalysis` | Đã cài đặt |
| `R-11` | `image` | `lib/images/processor.ts` | `processImageForAnalysis` | Đã cài đặt |
| `R-12` | `image` | `lib/images/processor.ts` | `sanitizeAndValidateImageAnalysis` | Đã cài đặt |
| `R-13` | `image` | `lib/images/processor.ts` | `computeImageSha256` | Đã cài đặt |
| `R-14` | `image` | `lib/llm/index.ts` | `createLlmProvider` | Đã cài đặt |
| `R-15` | `image` | `lib/knowledge/rules.ts` | `loadRules` | Đã cài đặt |
| `R-16` | `image,write` | `lib/knowledge/rules.ts` | `loadRules` | Đã cài đặt |
| `R-17` | `image,check,site` | `lib/checks/index.ts` | `checkImageBlocks` | Đã cài đặt |
| `R-18` | `write,check` | `lib/checks/index.ts` | `checkBrandFactsAndForbiddenClaims` | Đã cài đặt |
| `R-19` | `write,check` | `lib/checks/index.ts` | `checkSeoTitleAndMeta` | Đã cài đặt |
| `R-20` | `write,site` | `lib/checks/index.ts` | `checkSeoTitleAndMeta` | Đã cài đặt |
| `R-21` | `write` | `lib/knowledge/rules.ts` | `loadRules` | Đã cài đặt |
| `R-22` | `write` | `lib/knowledge/rules.ts` | `loadRules` | Đã cài đặt |
| `R-23` | `write,site` | `lib/knowledge/rules.ts` | `loadRules` | Đã cài đặt |
| `R-24` | `write` | `lib/supabase/types.ts` | `ContentBlockSchema` | Đã cài đặt |
| `R-25` | `schema` | `lib/seo/schema.ts` | `serializeJsonLd` | Đã cài đặt |
| `R-26` | `schema,check` | `lib/seo/schema.ts` | `validateArticleJsonLd` | Đã cài đặt |
| `R-27` | `schema` | `lib/seo/schema.ts` | `buildArticleJsonLd` | Đã cài đặt |
| `R-28` | `schema,check` | `lib/seo/schema.ts` | `validateArticleJsonLd` | Đã cài đặt |
| `R-29` | `schema,check` | `lib/seo/schema.ts` | `validateArticleJsonLd` | Đã cài đặt |
| `R-30` | `check,site` | `lib/knowledge/rules.ts` | `loadRules` | Đã cài đặt |
| `R-31` | `check` | `lib/checks/index.ts` | `checkBrandFactsAndForbiddenClaims` | Đã cài đặt |
| `R-32` | `check` | `lib/checks/index.ts` | `checkBrandFactsAndForbiddenClaims` | Đã cài đặt |
| `R-33` | `check` | `lib/knowledge/rules.ts` | `loadRules` | Đã cài đặt |
| `R-34` | `gate` | `lib/checks/index.ts` | `runAllArticleChecks` | Đã cài đặt |
| `R-35` | `gate` | `lib/checks/index.ts` | `runAllArticleChecks` | Đã cài đặt |
| `R-36` | `gate` | `app/admin/articles/[id]/actions.ts` | `transitionArticleAction` | Đã cài đặt |
| `R-37` | `gate` | `supabase/migrations/001_content_agent.sql` | `transition_article` | Đã cài đặt |
| `R-38` | `gate,site` | `lib/llm/index.ts` | `createLlmProvider` | Đã cài đặt |
| `R-39` | `site` | `app/robots.txt/route.ts` | `GET` | Đã cài đặt |
| `R-40` | `site` | `app/llms.txt/route.ts` | `GET` | Đã cài đặt |
| `R-41` | `site` | `components/ArticleRenderer.tsx` | `ArticleRenderer` | Đã cài đặt |
| `R-42` | `site` | `lib/llm/index.ts` | `assertTokenBudgetAvailable` | Đã cài đặt |
