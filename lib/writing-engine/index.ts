export {
  WRITING_ENGINE_PROMPT_VERSION,
  ContentTypeValues,
  SearchIntentAnalysisSchema,
  PlanOutlineEngineOutputSchema,
  WriteArticleEngineOutputSchema,
  type ContentType,
  type SearchIntentAnalysis,
  type PlanOutlineEngineOutput,
  type WriteArticleEngineOutput,
  type VerifiedOutlineResult,
  type VerifiedArticleClaimsResult,
} from "./types";

export {
  PROMPT_REGISTRY,
  analyzeSearchIntentAndTopic,
  buildNonOverlappingTopicSchedule,
  buildPlanOutlineSystemPrefix,
  buildPlanOutlineUserPrompt,
  buildWriteArticleSystemPrefix,
  buildWriteArticleUserPrompt,
  type IntentAndTopicPreAnalysis,
  type PlanOutlinePromptInput,
  type WriteArticlePromptInput,
  type PromptRegistryItem,
} from "./prompts";

export {
  blockMentionsBrandOrProduct,
  verifyOutlineFacts,
  verifyArticleClaimsAndEnforceTruthLabels,
  type VerifyArticleClaimsInput,
} from "./fact-verifier";

export {
  buildOrchestratorJobStatus,
  suggestInternalLinks,
  buildWebsiteContentStandardExport,
  type ContentOrchestratorOutput,
  type SuggestedInternalLink,
  type WebsiteContentStandardDeliverable,
} from "./orchestrator-report";

/**
 * Năng lực 7: Content Revalidation
 * Trả về danh sách các đường dẫn cần làm mới cache trên Next.js khi bài viết được xuất bản.
 */
export function getRevalidatePathsForArticle(slug?: string | null): string[] {
  const paths = ["/blog", "/llms.txt"];
  if (slug && slug.trim()) {
    paths.push(`/blog/${slug.trim().replace(/^\/+/, "")}`);
  }
  return paths;
}

