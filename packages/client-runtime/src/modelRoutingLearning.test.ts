import { describe, expect, it } from "vite-plus/test";

import type { TurnComplexity } from "./modelRouting.ts";
import {
  applyLearnedRouting,
  extractRoutingTerms,
  recordRoutingCorrection,
  tierForModelPick,
} from "./modelRoutingLearning.ts";

const complexity = (tier: TurnComplexity["tier"]): TurnComplexity => ({
  tier,
  score: 0,
  signals: [],
  continuation: false,
  uncertain: false,
});

describe("extractRoutingTerms", () => {
  it("keeps meaningful words, accents included, without stopwords or duplicates", () => {
    expect(extractRoutingTerms("Revisa la migración de la migración para Postgres 2026")).toEqual([
      "revisa",
      "migración",
      "postgres",
    ]);
  });
});

describe("routing corrections", () => {
  it("pulls later asks with the same terms toward the corrected tier", () => {
    const learned = recordRoutingCorrection(
      {},
      "revisa la migración de postgres",
      "medium",
      "reasoning",
    );
    const adjusted = applyLearnedRouting(
      complexity("medium"),
      "otra migración en postgres",
      learned,
    );
    expect(adjusted.tier).toBe("reasoning");
    expect(adjusted.signals).toContain("learned +2");
    expect(applyLearnedRouting(complexity("simple"), "migración", learned).tier).toBe("complex");
  });

  it("learns downward corrections and ignores unrelated prompts", () => {
    const learned = recordRoutingCorrection({}, "cambia el copy del botón", "complex", "simple");
    expect(applyLearnedRouting(complexity("complex"), "el copy del botón", learned).tier).toBe(
      "simple",
    );
    expect(applyLearnedRouting(complexity("complex"), "refactor del router", learned).tier).toBe(
      "complex",
    );
  });

  it("reproduces a full-range correction on the first pick", () => {
    const learned = recordRoutingCorrection(
      {},
      "diseña el sistema de colas",
      "simple",
      "reasoning",
    );
    expect(
      applyLearnedRouting(complexity("simple"), "diseña el sistema de colas", learned).tier,
    ).toBe("reasoning");
  });

  it("does not record a correction to the same tier", () => {
    const learned = { postgres: 1 };
    expect(recordRoutingCorrection(learned, "postgres", "complex", "complex")).toBe(learned);
  });

  it("keeps the learned table bounded", () => {
    let learned = {};
    for (let index = 0; index < 40; index += 1) {
      const words = Array.from({ length: 10 }, (_, word) => `term${index}x${word}`).join(" ");
      learned = recordRoutingCorrection(learned, words, "simple", "reasoning");
    }
    expect(Object.keys(learned).length).toBeLessThanOrEqual(300);
  });
});

describe("tierForModelPick", () => {
  it("finds the tier of a hand-picked model, nearest the routed one", () => {
    expect(tierForModelPick("claudeAgent", "claude-opus-5-5", undefined, "medium")).toBe("complex");
    expect(tierForModelPick("claudeAgent", "claude-opus-5-5", undefined, "reasoning")).toBe(
      "reasoning",
    );
    expect(tierForModelPick("claudeAgent", "claude-fable-5-1", undefined, "medium")).toBeNull();
  });
});
