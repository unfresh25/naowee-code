import type { ModelRoutingTierOverrides } from "@t3tools/contracts/settings";

import {
  MODEL_ROUTING_TIERS,
  resolveModelRoutingTiers,
  type ModelRoutingTier,
  type TurnComplexity,
} from "./modelRouting.ts";

export type LearnedRoutingTerms = Readonly<Record<string, number>>;

const MAX_TERMS_PER_PROMPT = 16;
const MAX_LEARNED_TERMS = 300;
const MAX_TERM_WEIGHT = 3;
const CORRECTION_STEP = 1;
const WEIGHT_RETENTION = 0.8;
const MIN_APPLIED_PULL = 0.5;

const STOPWORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "what",
  "when",
  "where",
  "which",
  "would",
  "could",
  "should",
  "there",
  "their",
  "about",
  "into",
  "please",
  "also",
  "just",
  "like",
  "make",
  "para",
  "como",
  "esto",
  "esta",
  "este",
  "estos",
  "estas",
  "pero",
  "porque",
  "cuando",
  "donde",
  "sobre",
  "todo",
  "todos",
  "tambien",
  "también",
  "puedes",
  "hacer",
  "quiero",
  "favor",
  "desde",
  "entre",
  "hasta",
  "tiene",
  "tienen",
  "hace",
]);

const TIER_INDEX = new Map(MODEL_ROUTING_TIERS.map((tier, index) => [tier, index] as const));
const tierIndex = (tier: ModelRoutingTier) => TIER_INDEX.get(tier) ?? 0;

export function extractRoutingTerms(prompt: string): ReadonlyArray<string> {
  const terms = new Set<string>();
  for (const word of prompt.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []) {
    if (word.length < 4 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    terms.add(word);
    if (terms.size === MAX_TERMS_PER_PROMPT) break;
  }
  return [...terms];
}

export function applyLearnedRouting(
  complexity: TurnComplexity,
  prompt: string,
  learned: LearnedRoutingTerms,
): TurnComplexity {
  const weights = extractRoutingTerms(prompt)
    .map((term) => learned[term])
    .filter((weight): weight is number => weight !== undefined);
  if (weights.length === 0) return complexity;
  const pull = weights.reduce((sum, weight) => sum + weight, 0) / weights.length;
  if (Math.abs(pull) < MIN_APPLIED_PULL) return complexity;
  const shift = Math.max(-3, Math.min(3, Math.sign(pull) * Math.round(Math.abs(pull))));
  const index = Math.max(
    0,
    Math.min(MODEL_ROUTING_TIERS.length - 1, tierIndex(complexity.tier) + shift),
  );
  const tier = MODEL_ROUTING_TIERS[index]!;
  if (tier === complexity.tier) return complexity;
  return {
    ...complexity,
    tier,
    signals: [...complexity.signals, `learned ${shift > 0 ? "+" : ""}${shift}`],
  };
}

export function recordRoutingCorrection(
  learned: LearnedRoutingTerms,
  prompt: string,
  from: ModelRoutingTier,
  to: ModelRoutingTier,
): LearnedRoutingTerms {
  const delta = tierIndex(to) - tierIndex(from);
  const terms = extractRoutingTerms(prompt);
  if (delta === 0 || terms.length === 0) return learned;
  const next: Record<string, number> = { ...learned };
  for (const term of terms) {
    const weight = (next[term] ?? 0) * WEIGHT_RETENTION + delta * CORRECTION_STEP;
    next[term] = Math.max(-MAX_TERM_WEIGHT, Math.min(MAX_TERM_WEIGHT, weight));
  }
  const entries = Object.entries(next);
  if (entries.length <= MAX_LEARNED_TERMS) return next;
  entries.sort(([, left], [, right]) => Math.abs(right) - Math.abs(left));
  return Object.fromEntries(entries.slice(0, MAX_LEARNED_TERMS));
}

export function tierForModelPick(
  driver: string,
  model: string,
  overrides: ModelRoutingTierOverrides | undefined,
  near: ModelRoutingTier,
): ModelRoutingTier | null {
  const tiers = resolveModelRoutingTiers(driver, overrides);
  if (!tiers) return null;
  let best: ModelRoutingTier | null = null;
  for (const tier of MODEL_ROUTING_TIERS) {
    if (tiers[tier].model !== model) continue;
    if (
      best === null ||
      Math.abs(tierIndex(tier) - tierIndex(near)) < Math.abs(tierIndex(best) - tierIndex(near))
    ) {
      best = tier;
    }
  }
  return best;
}
