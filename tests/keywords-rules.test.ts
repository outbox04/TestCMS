import { describe, expect, it } from "vitest";
import {
  clusterKeywordsByIntent,
  deduplicateAndCapKeywords,
} from "@/lib/keywords/provider";
import { loadRules, parseAllRules } from "@/lib/knowledge/rules";
import { assertTokenBudgetAvailable } from "@/lib/llm";

describe("lib/keywords/provider.ts & lib/knowledge/rules.ts & lib/llm", () => {
  it("Loại trùng từ khóa không phân biệt hoa/thường và giới hạn số lượng tối đa", () => {
    const input = [
      "  Máy pha cà phê  ",
      "máy pha cà phê",
      "MÁY PHA CÀ PHÊ",
      "máy xay cà phê",
      "cách pha espresso",
    ];
    const deduped = deduplicateAndCapKeywords(input, 2);
    expect(deduped).toEqual(["Máy pha cà phê", "máy xay cà phê"]);
  });

  it("Gán volume = unknown và targetStatus = proposed khi gom cụm từ khóa (R-04, R-06)", () => {
    const clustered = clusterKeywordsByIntent([
      "máy pha cà phê LumiBrew Mini X1",
      "cách pha cà phê tại nhà",
    ]);
    expect(clustered).toHaveLength(2);
    expect(clustered[0].volume).toBe("unknown");
    expect(clustered[0].targetStatus).toBe("proposed");
  });

  it("loadRules(step) chỉ nạp các dòng quy tắc thuộc đúng thẻ bước được yêu cầu", () => {
    const allRules = parseAllRules();
    expect(allRules.length).toBeGreaterThanOrEqual(40);

    const planText = loadRules("plan");
    const planLines = planText.split("\n").filter(Boolean);
    expect(planLines.length).toBeGreaterThan(0);
    for (const line of planLines) {
      expect(line).toMatch(/\[R-\d{2}\]\[[^\]]*plan[^\]]*\]/);
    }
    expect(planText).not.toContain("[R-10][image]");

    const writeAndSchemaText = loadRules(["write", "schema"]);
    expect(writeAndSchemaText).toContain("[R-19][write,check]");
    expect(writeAndSchemaText).toContain("[R-25][schema]");
    expect(writeAndSchemaText).not.toContain("[R-01][plan]");
  });

  it("assertTokenBudgetAvailable chặn mọi lệnh gọi khi monthlyBudget = 1 hoặc vượt ngân sách (Kịch bản F)", () => {
    expect(() =>
      assertTokenBudgetAvailable({ usedThisMonth: 0, monthlyBudget: 1 })
    ).toThrow(/hạn mức token tháng/);

    expect(() =>
      assertTokenBudgetAvailable({
        usedThisMonth: 2000000,
        monthlyBudget: 2000000,
      })
    ).toThrow(/hạn mức token tháng/);

    expect(() =>
      assertTokenBudgetAvailable({ usedThisMonth: 500, monthlyBudget: 2000000 })
    ).not.toThrow();
  });
});

