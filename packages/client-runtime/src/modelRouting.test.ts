import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";

import {
  classifyTurnComplexity,
  resolveAutoModelSelection,
  type TurnComplexity,
} from "./modelRouting.ts";

const claude = ProviderInstanceId.make("claudeAgent");
const codex = ProviderInstanceId.make("codex");
const CLAUDE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
const CODEX_MODELS = ["gpt-6-luna", "gpt-6.1-sol"];

const classify = (
  prompt: string,
  extra: Partial<Parameters<typeof classifyTurnComplexity>[0]> = {},
) =>
  classifyTurnComplexity({
    prompt,
    attachmentCount: 0,
    contextCount: 0,
    planMode: false,
    ...extra,
  });

const complexity = (tier: TurnComplexity["tier"], continuation = false): TurnComplexity => ({
  tier,
  score: 0,
  signals: [],
  continuation,
});

describe("classifyTurnComplexity", () => {
  it("keeps trivial asks simple", () => {
    expect(classify("qué es un monorepo?").tier).toBe("simple");
    expect(classify("renombra la variable foo a bar").tier).toBe("simple");
  });

  it("raises code work with several technical signals", () => {
    const result = classify(
      "Refactoriza el endpoint de auth en apps/server/src/auth/http.ts para que valide el JWT y agrega tests de la consulta a postgres",
    );
    expect(["complex", "reasoning"]).toContain(result.tier);
  });

  it("routes explicit multi-marker reasoning to the top tier", () => {
    expect(
      classify("Analiza paso a paso por qué falla el deploy y compara los trade-offs de cada fix")
        .tier,
    ).toBe("reasoning");
  });

  it("reads accented Spanish markers", () => {
    const result = classify("por qué el índice de la caché no se usa? analiza la consulta");
    expect(result.signals).toContain("reasoning x2");
    expect(result.signals.some((signal) => signal.startsWith("technical"))).toBe(true);
  });

  it("never classifies plan mode below complex", () => {
    expect(classify("hola", { planMode: true }).tier).toBe("complex");
  });

  it("recognizes short approvals as continuations", () => {
    expect(classify("sí, hazlo").continuation).toBe(true);
    expect(classify("dale").continuation).toBe(true);
    expect(classify("sí, pero cambia también el README").continuation).toBe(false);
  });
});

describe("resolveAutoModelSelection", () => {
  const base = {
    threadStarted: false,
    threadBusy: false,
    current: null,
  };

  it("maps tiers to the configured model and effort per provider", () => {
    expect(
      resolveAutoModelSelection({
        ...base,
        driver: "claudeAgent",
        instanceId: claude,
        complexity: complexity("simple"),
        availableModels: CLAUDE_MODELS,
      })?.selection,
    ).toEqual(createModelSelection(claude, "claude-haiku-5-5", [{ id: "effort", value: "high" }]));
    expect(
      resolveAutoModelSelection({
        ...base,
        driver: "codex",
        instanceId: codex,
        complexity: complexity("medium"),
        availableModels: CODEX_MODELS,
      })?.selection,
    ).toEqual(
      createModelSelection(codex, "gpt-6-luna", [{ id: "reasoningEffort", value: "xhigh" }]),
    );
  });

  it("only escalates Claude within a started thread", () => {
    const opus = createModelSelection(claude, "claude-opus-5-5", [
      { id: "effort", value: "medium" },
    ]);
    const decision = resolveAutoModelSelection({
      ...base,
      driver: "claudeAgent",
      instanceId: claude,
      complexity: complexity("simple"),
      current: opus,
      threadStarted: true,
      availableModels: CLAUDE_MODELS,
    });
    expect(decision?.selection).toBe(opus);
    expect(decision?.reason).toBe("escalate-only");
  });

  it("lets Codex move down between turns", () => {
    const sol = createModelSelection(codex, "gpt-6.1-sol", [
      { id: "reasoningEffort", value: "xhigh" },
    ]);
    expect(
      resolveAutoModelSelection({
        ...base,
        driver: "codex",
        instanceId: codex,
        complexity: complexity("simple"),
        current: sol,
        threadStarted: true,
        availableModels: CODEX_MODELS,
      })?.selection.model,
    ).toBe("gpt-6-luna");
  });

  it("keeps the current model for continuations and busy threads", () => {
    const sol = createModelSelection(codex, "gpt-6.1-sol", [
      { id: "reasoningEffort", value: "medium" },
    ]);
    const input = {
      ...base,
      driver: "codex",
      instanceId: codex,
      current: sol,
      threadStarted: true,
      availableModels: CODEX_MODELS,
    };
    expect(
      resolveAutoModelSelection({ ...input, complexity: complexity("simple", true) })?.reason,
    ).toBe("continuation");
    expect(
      resolveAutoModelSelection({ ...input, threadBusy: true, complexity: complexity("simple") })
        ?.reason,
    ).toBe("busy");
  });

  it("leaves a hand-picked Claude model alone once the thread started", () => {
    const manual = createModelSelection(claude, "claude-sonnet-5-5", [
      { id: "effort", value: "low" },
    ]);
    expect(
      resolveAutoModelSelection({
        ...base,
        driver: "claudeAgent",
        instanceId: claude,
        complexity: complexity("reasoning"),
        current: manual,
        threadStarted: true,
        availableModels: CLAUDE_MODELS,
      })?.reason,
    ).toBe("unmanaged");
  });

  it("moves to the nearest available tier when a model is missing", () => {
    expect(
      resolveAutoModelSelection({
        ...base,
        driver: "claudeAgent",
        instanceId: claude,
        complexity: complexity("simple"),
        availableModels: ["claude-sonnet-5-5", "claude-opus-5-5"],
      })?.selection.model,
    ).toBe("claude-sonnet-5-5");
  });

  it("uses saved tier overrides over the defaults", () => {
    expect(
      resolveAutoModelSelection({
        ...base,
        driver: "claudeAgent",
        instanceId: claude,
        complexity: complexity("simple"),
        availableModels: CLAUDE_MODELS,
        tierOverrides: { simple: { model: "claude-sonnet-5-5", effort: "low" } },
      })?.selection,
    ).toEqual(createModelSelection(claude, "claude-sonnet-5-5", [{ id: "effort", value: "low" }]));
  });

  it("does not route providers without a profile", () => {
    expect(
      resolveAutoModelSelection({
        ...base,
        driver: "cursor",
        instanceId: ProviderInstanceId.make("cursor"),
        complexity: complexity("simple"),
        availableModels: [],
      }),
    ).toBeNull();
  });
});
