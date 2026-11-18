import { z } from "zod";
import { CHECK_CONFIG } from "@/lib/checks/config";
import {
  ArticleSeoSchema,
  ContentBlockSchema,
  OutlineItemSchema,
  SearchIntentValues,
  type ClaimLabel,
  type ContentBlock,
  type OutlineItem,
  type SearchIntent,
} from "@/lib/supabase/types";

export const WRITING_ENGINE_PROMPT_VERSION = "2.0.0" as const;

export const ContentTypeValues = [
  "news",
  "product",
  "service",
  "knowledge",
  "guide",
  "comparison",
  "pillar",
] as const;

export type ContentType = (typeof ContentTypeValues)[number];

/**
 * Năng lực 1: Search Intent Analysis Schema
 */
export const SearchIntentAnalysisSchema = z.object({
  search_intent: z.enum(SearchIntentValues).default("informational"),
  content_type: z.enum(ContentTypeValues).default("guide"),
  user_problem: z.string().optional(),
});

export type SearchIntentAnalysis = z.infer<typeof SearchIntentAnalysisSchema>;

/**
 * Năng lực 1 + 2 + 3: Đầu ra tích hợp của bước Lập kế hoạch & Dàn ý (plan_outline)
 * Tương thích ngược 100% với PlanOutlineOutputSchema cũ.
 */
export const PlanOutlineEngineOutputSchema = z.object({
  search_intent: z.enum(SearchIntentValues).optional(),
  content_type: z.string().optional(),
  primary_keyword: z.string().min(1),
  secondary_keywords: z
    .array(z.string().min(1))
    .max(CHECK_CONFIG.MAX_SECONDARY_KEYWORDS),
  faq_questions: z
    .array(z.string().min(1))
    .min(1)
    .max(CHECK_CONFIG.MAX_FAQ_COUNT),
  outline: z.array(OutlineItemSchema).min(CHECK_CONFIG.MIN_H2_COUNT),
  needs_info: z.array(z.string()),
});

export type PlanOutlineEngineOutput = z.infer<
  typeof PlanOutlineEngineOutputSchema
>;

/**
 * Năng lực 4 + 5 + 6: Đầu ra tích hợp của bước Viết bài chuẩn SEO/GEO/AEO (write_article)
 * Tương thích ngược 100% với WriteArticleOutputSchema cũ.
 */
export const WriteArticleEngineOutputSchema = z.object({
  seo: ArticleSeoSchema,
  content_blocks: z.array(ContentBlockSchema).min(3),
  needs_info: z.array(z.string()),
});

export type WriteArticleEngineOutput = z.infer<
  typeof WriteArticleEngineOutputSchema
>;

/**
 * Kết quả kiểm chứng dữ kiện (Năng lực 5: Fact Verification)
 */
export interface VerifiedOutlineResult {
  search_intent?: SearchIntent;
  content_type?: string;
  items: OutlineItem[];
  needs_info: string[];
  downgraded_count: number;
}

export interface VerifiedArticleClaimsResult {
  content_blocks: ContentBlock[];
  needs_info: string[];
  downgraded_blocks: number;
  label_summary: Record<ClaimLabel, number>;
}

