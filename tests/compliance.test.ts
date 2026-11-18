import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAllRules } from "@/lib/knowledge/rules";

interface ComplianceEntry {
  id: string;
  filePath: string;
  symbolName: string;
  status: string;
}

function parseComplianceMarkdown(content: string): ComplianceEntry[] {
  const entries: ComplianceEntry[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("| `R-")) continue;
    const cols = trimmed
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cols.length < 5) continue;

    const id = cols[0].replace(/`/g, "").trim();
    const filePath = cols[2].replace(/`/g, "").trim();
    const symbolName = cols[3].replace(/`/g, "").trim();
    const status = cols[4].trim();

    entries.push({ id, filePath, symbolName, status });
  }

  return entries;
}

describe("tests/compliance.test.ts — Đối chiếu RULES.md và COMPLIANCE.md", () => {
  it("Mọi ID quy tắc trong RULES.md đều được ánh xạ trong COMPLIANCE.md và file/hàm thực thi tồn tại thật", () => {
    const rules = parseAllRules();
    expect(rules.length).toBeGreaterThan(0);

    const compliancePath = path.join(
      process.cwd(),
      "docs",
      "knowledge",
      "COMPLIANCE.md"
    );
    const complianceContent = fs.readFileSync(compliancePath, "utf8");
    const entries = parseComplianceMarkdown(complianceContent);
    const mapById = new Map<string, ComplianceEntry>(
      entries.map((e) => [e.id, e])
    );

    for (const rule of rules) {
      const mapped = mapById.get(rule.id);
      expect(
        mapped,
        `Quy tắc ${rule.id} trong RULES.md chưa được ánh xạ trong COMPLIANCE.md`
      ).toBeDefined();

      if (!mapped) continue;

      const absFile = path.join(process.cwd(), mapped.filePath);
      expect(
        fs.existsSync(absFile),
        `File thực thi "${mapped.filePath}" cho quy tắc ${rule.id} không tồn tại`
      ).toBe(true);

      const fileContent = fs.readFileSync(absFile, "utf8");
      expect(
        fileContent.includes(mapped.symbolName),
        `Không tìm thấy hàm/thành phần "${mapped.symbolName}" trong file "${mapped.filePath}" (quy tắc ${rule.id})`
      ).toBe(true);
    }
  });
});

