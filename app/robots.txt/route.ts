import { NextResponse } from "next/server";
import { loadRules } from "@/lib/knowledge/rules";

/**
 * Cho phép các crawler AI hợp lệ (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Googlebot)
 * theo quy tắc R-39 trong docs/knowledge/RULES.md.
 */
export async function GET() {
  const siteRules = loadRules("site");
  const hasR39 = siteRules.includes("[R-39]");
  const siteUrl = (process.env.SITE_URL ?? "https://example.com").replace(
    /\/+$/,
    ""
  );

  const lines = [
    `# robots.txt generated from docs/knowledge/RULES.md (${hasR39 ? "R-39 active" : "default"})`,
    "User-agent: Googlebot",
    "Allow: /",
    "Disallow: /admin/",
    "",
    "User-agent: GPTBot",
    "Allow: /",
    "Disallow: /admin/",
    "",
    "User-agent: ClaudeBot",
    "Allow: /",
    "Disallow: /admin/",
    "",
    "User-agent: PerplexityBot",
    "Allow: /",
    "Disallow: /admin/",
    "",
    "User-agent: Google-Extended",
    "Allow: /",
    "Disallow: /admin/",
    "",
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin/",
    "",
    `Sitemap: ${siteUrl}/sitemap.xml`,
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

