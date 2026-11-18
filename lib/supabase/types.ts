import { z } from "zod";

export const ArticleStatusValues = [
  "outline_draft",
  "outline_review",
  "awaiting_images",
  "analyzing_images",
  "writing",
  "draft_ready",
  "preview_review",
  "scheduled",
  "published",
] as const;

export type ArticleStatus = (typeof ArticleStatusValues)[number];

export type UserRole = "admin" | "editor";

export interface ProfileRow {
  id: string;
  role: UserRole;
}

export interface AiSettingsRow {
  id: boolean;
  provider: string | null;
  model_writer: string | null;
  model_vision: string | null;
  api_key_secret_id: string | null;
  api_key_last4: string | null;
  monthly_token_budget: number;
  updated_by: string | null;
  updated_at: string;
}

export const ProductSpecSchema = z.record(z.string(), z.string());

export const BrandProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  price: z.number().nonnegative(),
  price_formatted: z.string().min(1),
  specs: ProductSpecSchema,
});

export type BrandProduct = z.infer<typeof BrandProductSchema>;

export const BrandFactSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  statement: z.string().min(1),
  verified_at: z.string().optional(),
});

export type BrandFact = z.infer<typeof BrandFactSchema>;

export const BrandProfileDataSchema = z.object({
  _notice: z.string().optional(),
  brand_name: z.string().min(1),
  description: z.string().min(1),
  products: z.array(BrandProductSchema),
  voice: z.string().min(1),
  facts: z.array(BrandFactSchema),
  forbidden_claims: z.array(z.string()),
});

export type BrandProfileData = z.infer<typeof BrandProfileDataSchema>;

export interface BrandProfileRow {
  id: boolean;
  brand_name: string | null;
  description: string | null;
  products: BrandProduct[];
  voice: string | null;
  facts: BrandFact[];
  forbidden_claims: string[];
  updated_by: string | null;
  updated_at: string;
}

export const ClaimLabelValues = [
  "VERIFIED",
  "USER_PROVIDED",
  "GENERAL_KNOWLEDGE",
  "NEEDS_VERIFICATION",
  "OPINION",
] as const;

export type ClaimLabel = (typeof ClaimLabelValues)[number];

export const SearchIntentValues = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
] as const;

export type SearchIntent = (typeof SearchIntentValues)[number];

export const OutlineItemSchema = z.object({
  h2: z.string().min(1),
  h3_items: z.array(z.string().min(1)).optional(),
  direct_answer_hint: z.string().optional(),
  key_points: z.array(z.string().min(1)).min(1),
  fact_ids: z.array(z.string().min(1)),
  claim_label: z.enum(ClaimLabelValues).optional(),
});

export type OutlineItem = z.infer<typeof OutlineItemSchema>;

export const ArticleOutlinePayloadSchema = z.object({
  search_intent: z.enum(SearchIntentValues).optional(),
  content_type: z.string().optional(),
  items: z.array(OutlineItemSchema),
  needs_info: z.array(z.string()).default([]),
  prompt_version: z.string().optional(),
});

export type ArticleOutlinePayload = z.infer<typeof ArticleOutlinePayloadSchema>;

export const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("h2"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("h3"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("paragraph"),
    text: z.string().min(1),
    fact_ids: z.array(z.string()).optional(),
    claim_label: z.enum(ClaimLabelValues).optional(),
  }),
  z.object({
    type: z.literal("list"),
    ordered: z.boolean().default(false),
    items: z.array(z.string().min(1)).min(1),
    fact_ids: z.array(z.string()).optional(),
    claim_label: z.enum(ClaimLabelValues).optional(),
  }),
  z.object({
    type: z.literal("table"),
    caption: z.string().optional(),
    headers: z.array(z.string().min(1)).min(1),
    rows: z.array(z.array(z.string())).min(1),
    fact_ids: z.array(z.string()).optional(),
    claim_label: z.enum(ClaimLabelValues).optional(),
  }),
  z.object({
    type: z.literal("image"),
    asset_id: z.string().min(1),
    alt: z.string(),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("faq"),
    q: z.string().min(1),
    a: z.string().min(1),
    fact_ids: z.array(z.string()).optional(),
    claim_label: z.enum(ClaimLabelValues).optional(),
  }),
  z.object({
    type: z.literal("callout"),
    title: z.string().optional(),
    text: z.string().min(1),
    fact_ids: z.array(z.string()).optional(),
    claim_label: z.enum(ClaimLabelValues).optional(),
  }),
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const ArticleSeoSchema = z.object({
  title: z.string().min(1),
  meta_description: z.string().min(1),
  search_intent: z.enum(SearchIntentValues).optional(),
  prompt_version: z.string().optional(),
  needs_info: z.array(z.string()).optional(),
});

export type ArticleSeo = z.infer<typeof ArticleSeoSchema>;

export interface CheckItemResult {
  code: string;
  ruleIds: string[];
  passed: boolean;
  message: string;
}

export type QualityRubricBand =
  | "READY_TO_PUBLISH"
  | "MINOR_EDITS"
  | "MAJOR_OPTIMIZATION"
  | "REWRITE_REQUIRED"
  | "BLOCKED_BY_TRUTH";

export interface QualityValidationFinding {
  code: string;
  severity: "HARD_BLOCKER" | "MAJOR_ISSUE" | "MINOR_WARNING";
  location: string;
  message: string;
}

export interface QualityRubricReport {
  seo_score: number;      // Tối đa 25
  geo_score: number;      // Tối đa 25
  aeo_score: number;      // Tối đa 20
  trust_score: number;    // Tối đa 15
  ux_score: number;       // Tối đa 15
  total_score: number;    // Tối đa 100
  band: QualityRubricBand;
  band_label: string;
  blocked_by_truth: boolean;
  advisory_notes: string[];
  hard_blockers?: QualityValidationFinding[];
  major_issues?: QualityValidationFinding[];
  minor_warnings?: QualityValidationFinding[];
  passed_checks?: string[];
}

export interface CheckReport {
  passed: boolean;
  checked_at: string;
  items: CheckItemResult[];
  needs_info: string[];
  quality_score?: QualityRubricReport;
}

export interface ArticleRow {
  id: string;
  topic: string;
  slug: string | null;
  planned_publish_at: string | null;
  status: ArticleStatus;
  version: number;
  primary_keyword: string | null;
  secondary_keywords: string[];
  faq_questions: string[];
  outline: ArticleOutlinePayload | OutlineItem[] | null;
  content_blocks: ContentBlock[] | null;
  seo: ArticleSeo | null;
  checks_passed: boolean;
  check_report: CheckReport | null;
  scheduled_at: string | null;
  published_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const ImageAnalysisSchema = z.object({
  description: z.string().min(1),
  alt_text: z.string().min(1).max(125),
  subjects: z.array(z.string()),
  visible_text: z.string().nullable(),
});

export type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;

export interface ArticleAssetRow {
  id: string;
  article_id: string;
  storage_path: string;
  analysis_path: string | null;
  sha256: string;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  analysis: ImageAnalysis | null;
  analyzed_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ArticleEventRow {
  id: number;
  article_id: string;
  from_status: ArticleStatus | null;
  to_status: ArticleStatus;
  actor: string | null;
  actor_kind: "editor" | "agent" | "system";
  note: string | null;
  created_at: string;
}

export interface AiRunRow {
  id: number;
  article_id: string | null;
  step: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  created_at: string;
}

export type AiProviderId =
  | "muse"
  | "xingchi"
  | "gemini"
  | "openai"
  | "anthropic";

export type AiConnectionStatus =
  | "connected"
  | "disconnected"
  | "expired"
  | "error"
  | "unsupported";

export type AiAuthType = "cookie" | "api_token" | "oauth";

export interface AiProviderConnectionRow {
  id: string;
  provider: AiProviderId;
  scope: "global";
  auth_type: AiAuthType;
  encrypted_credentials: string | null;
  status: AiConnectionStatus;
  error_code: string | null;
  error_message: string | null;
  last_verified_at: string | null;
  last_used_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AiProviderTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface AiProviderLogRow {
  id: number;
  provider: string;
  task_type: string;
  user_id: string | null;
  status: AiProviderTaskStatus;
  duration_ms: number;
  error_code: string | null;
  created_at: string;
}

