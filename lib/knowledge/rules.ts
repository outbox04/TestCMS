import fs from "node:fs";
import path from "node:path";

export const RULE_STEPS = [
  "plan",
  "image",
  "write",
  "schema",
  "check",
  "gate",
  "site",
] as const;

export type RuleStep = (typeof RULE_STEPS)[number];

export interface ParsedRule {
  id: string;
  steps: RuleStep[];
  text: string;
  source: string;
  unverified: boolean;
  rawLine: string;
}

const RULE_LINE_REGEX =
  /^-\s+\[(R-\d{2})\]\[([a-z,\s]+)\]\s+(.+?)\s+—\s+nguồn:\s+(.+)$/;

export function parseRulesContent(markdownContent: string): ParsedRule[] {
  const lines = markdownContent.split(/\r?\n/);
  const rules: ParsedRule[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("- [R-")) continue;

    const match = RULE_LINE_REGEX.exec(trimmed);
    if (!match) continue;

    const id = match[1];
    const stepTokens = match[2]
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is RuleStep =>
        (RULE_STEPS as readonly string[]).includes(s)
      );
    const bodyText = match[3].trim();
    const source = match[4].trim();

    rules.push({
      id,
      steps: stepTokens,
      text: bodyText,
      source,
      unverified: bodyText.includes("[chưa xác minh]"),
      rawLine: trimmed,
    });
  }

  return rules;
}

export function parseAllRules(customPath?: string): ParsedRule[] {
  const content = customPath
    ? fs.readFileSync(/*turbopackIgnore: true*/ customPath, "utf8")
    : fs.readFileSync(
        path.join(process.cwd(), "docs", "knowledge", "RULES.md"),
        "utf8"
      );
  return parseRulesContent(content);
}

/**
 * Nạp các dòng quy tắc từ docs/knowledge/RULES.md chỉ thuộc bước (hoặc mảng bước) được yêu cầu.
 * Giúp tiết kiệm token đầu vào cho mỗi bước gọi AI — R-16.
 */
export function loadRules(
  stepOrSteps: RuleStep | RuleStep[],
  customPath?: string
): string {
  const steps = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps];
  const stepSet = new Set<RuleStep>(steps);
  const allRules = parseAllRules(customPath);
  const matched = allRules.filter((rule) =>
    rule.steps.some((s) => stepSet.has(s))
  );
  return matched.map((r) => r.rawLine).join("\n");
}

