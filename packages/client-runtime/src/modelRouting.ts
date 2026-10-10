import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import type { ModelRoutingTierOverrides } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";

export type ModelRoutingTier = "simple" | "medium" | "complex" | "reasoning";

export const MODEL_ROUTING_TIERS: ReadonlyArray<ModelRoutingTier> = [
  "simple",
  "medium",
  "complex",
  "reasoning",
];
const TIER_ORDER = MODEL_ROUTING_TIERS;

interface ModelRoutingTarget {
  readonly model: string;
  readonly effort: string;
}

interface ModelRoutingProfile {
  readonly effortOptionId: string;
  readonly escalateOnly: boolean;
  readonly tiers: Readonly<Record<ModelRoutingTier, ModelRoutingTarget>>;
}

export const MODEL_ROUTING_PROFILES: Readonly<Record<string, ModelRoutingProfile>> = {
  claudeAgent: {
    effortOptionId: "effort",
    escalateOnly: true,
    tiers: {
      simple: { model: "claude-haiku-5-5", effort: "high" },
      medium: { model: "claude-sonnet-5-5", effort: "high" },
      complex: { model: "claude-opus-5-5", effort: "medium" },
      reasoning: { model: "claude-opus-5-5", effort: "high" },
    },
  },
  codex: {
    effortOptionId: "reasoningEffort",
    escalateOnly: false,
    tiers: {
      simple: { model: "gpt-6-luna", effort: "medium" },
      medium: { model: "gpt-6-luna", effort: "xhigh" },
      complex: { model: "gpt-6.1-sol", effort: "medium" },
      reasoning: { model: "gpt-6.1-sol", effort: "xhigh" },
    },
  },
};

export function supportsModelRouting(driver: string): boolean {
  return Object.hasOwn(MODEL_ROUTING_PROFILES, driver);
}

export function modelRoutingEffortOptionId(driver: string): string | null {
  return MODEL_ROUTING_PROFILES[driver]?.effortOptionId ?? null;
}

export function resolveModelRoutingTiers(
  driver: string,
  overrides: ModelRoutingTierOverrides | undefined,
): Readonly<Record<ModelRoutingTier, ModelRoutingTarget>> | null {
  const profile = MODEL_ROUTING_PROFILES[driver];
  if (!profile) return null;
  return { ...profile.tiers, ...overrides };
}

export interface TurnComplexityInput {
  readonly prompt: string;
  readonly attachmentCount: number;
  readonly contextCount: number;
  readonly planMode: boolean;
}

export interface TurnComplexity {
  readonly tier: ModelRoutingTier;
  readonly score: number;
  readonly signals: ReadonlyArray<string>;
  readonly continuation: boolean;
}

const WORD = "[\\p{L}\\p{N}_]";
const UNICODE_BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;
const unicodeWords = (patterns: ReadonlyArray<RegExp>) =>
  patterns.map(
    (pattern) =>
      new RegExp(pattern.source.replaceAll("\\b", UNICODE_BOUNDARY), `${pattern.flags}u`),
  );

const CODE_PATTERNS = unicodeWords([
  /```/,
  /`[^`\n]+`/,
  /\b[\w./-]+\.(?:ts|tsx|js|jsx|py|rs|go|sql|json|ya?ml|toml|css|html|md|sh|swift|kt|java)\b/i,
  /\b(?:function|class|interface|endpoint|api|query|sql|schema|component|hook|test|tests|bug|error|exception|stack ?trace|stacktrace|deploy|build|compile|lint|typecheck|regex|script|migration|migraci[oó]n|refactor\w*|implement\w*|implementa\w*|funci[oó]n|clase|consulta|prueba\w*|despliegue|compila\w*)\b/i,
]);

const REASONING_MARKERS = unicodeWords([
  /\bstep by step\b/i,
  /\bpaso a paso\b/i,
  /\bthink (?:through|hard|deeply)\b/i,
  /\bpiensa (?:bien|a fondo|detenidamente)\b/i,
  /\banaly[sz]e\b|\banaliza\w*\b|\ban[aá]lisis\b/i,
  /\breason(?:ing)?\b|\brazona\w*\b/i,
  /\btrade-?offs?\b|\bpros y contras\b|\bventajas y desventajas\b/i,
  /\b(?:compare|compara\w*)\b/i,
  /\b(?:investigate|investiga\w*|root cause|causa ra[ií]z)\b/i,
  /\b(?:design|dise[nñ]a\w*|arquitectura|architecture)\b/i,
  /\bpor qu[eé]\b|\bwhy\b/i,
]);

const TECHNICAL_TERMS = unicodeWords([
  /\b(?:distributed|distribuid\w*|concurren\w*|race condition|deadlock|paralel\w*|parallel)\b/i,
  /\b(?:performance|rendimiento|optimi[sz]\w*|latenc\w*|scalab\w*|escalab\w*|throughput)\b/i,
  /\b(?:security|seguridad|encrypt\w*|cifra\w*|auth\w*|oauth|jwt|permission\w*|permiso\w*)\b/i,
  /\b(?:database|base de datos|postgres\w*|mysql|sqlite|redis|kafka|index\w*|[ií]ndice|transaction\w*|transacci[oó]n\w*)\b/i,
  /\b(?:kubernetes|k8s|docker|terraform|infra\w*|pipeline|ci\/cd|cluster\w*)\b/i,
  /\b(?:cach[eé]|memory leak|fuga de memoria|async|asynchronous|as[ií]ncron\w*|websocket\w*|protocol\w*|protocolo\w*)\b/i,
]);

const SIMPLE_INDICATORS = unicodeWords([
  /^\s*(?:what is|what's|define|qu[eé] es|qu[eé] significa|cu[aá]l es)\b/i,
  /\b(?:typo|rename|renombra\w*|traduce|translate|formatea|format this)\b/i,
  /^\s*(?:hi|hello|hey|hola|buenas|thanks|thank you|gracias)\b/i,
  /\b(?:cambia el (?:texto|nombre|color)|change the (?:text|label|name|color))\b/i,
]);

const MULTI_STEP_PATTERNS = unicodeWords([
  /^\s*\d+[.)]\s/m,
  /\b(?:first|primero)\b[\s\S]*\b(?:then|luego|despu[eé]s|finally|finalmente)\b/i,
  /^\s*[-*]\s[\s\S]*^\s*[-*]\s[\s\S]*^\s*[-*]\s/m,
]);

const CONTINUATION_WORDS =
  "s[ií]|ok(?:ay)?|okey|dale|hazlo|adelante|contin[uú]a|sigue|listo|perfecto|vale|va|de acuerdo|por favor|yes|yep|yeah|sure|go ahead|go|do it|proceed|continue|sounds good|lgtm|please|gracias|thanks";
const CONTINUATION_PATTERN = new RegExp(
  `^\\s*(?:${CONTINUATION_WORDS})(?:[\\s,!.]+(?:${CONTINUATION_WORDS}))*[\\s!.]*$`,
  "iu",
);

const TIER_BOUNDARIES = { simpleMedium: 0.15, mediumComplex: 0.35, complexReasoning: 0.6 };

const WEIGHTS = {
  tokenCount: 0.1,
  codePresence: 0.3,
  reasoningMarkers: 0.25,
  technicalTerms: 0.25,
  simpleIndicators: 0.15,
  multiStepPatterns: 0.1,
  questionComplexity: 0.05,
  attachedContext: 0.1,
};

const countMatches = (patterns: ReadonlyArray<RegExp>, text: string) =>
  patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);

const saturate = (count: number, full: number) => Math.min(1, count / full);

export function classifyTurnComplexity(input: TurnComplexityInput): TurnComplexity {
  const prompt = input.prompt.trim();
  const signals: string[] = [];
  const continuation = CONTINUATION_PATTERN.test(prompt);
  const approxTokens = Math.ceil(prompt.length / 4);

  const tokenScore = approxTokens < 15 ? -1 : approxTokens > 400 ? 1 : 0;
  if (approxTokens < 15) signals.push(`short (${approxTokens} tokens)`);
  if (approxTokens > 400) signals.push(`long (${approxTokens} tokens)`);

  const codeHits = countMatches(CODE_PATTERNS, prompt);
  if (codeHits > 0) signals.push("code");
  const reasoningHits = countMatches(REASONING_MARKERS, prompt);
  if (reasoningHits > 0) signals.push(`reasoning x${reasoningHits}`);
  const technicalHits = countMatches(TECHNICAL_TERMS, prompt);
  if (technicalHits > 0) signals.push(`technical x${technicalHits}`);
  const simpleHits = countMatches(SIMPLE_INDICATORS, prompt);
  if (simpleHits > 0) signals.push("simple ask");
  const multiStepHits = countMatches(MULTI_STEP_PATTERNS, prompt);
  if (multiStepHits > 0) signals.push("multi-step");
  const questionMarks = (prompt.match(/\?/g) ?? []).length;
  if (questionMarks >= 2) signals.push(`${questionMarks} questions`);
  const attached = input.attachmentCount + input.contextCount;
  if (attached > 0) signals.push(`${attached} attached`);

  const score =
    WEIGHTS.tokenCount * tokenScore +
    WEIGHTS.codePresence * saturate(codeHits, 2) +
    WEIGHTS.reasoningMarkers * saturate(reasoningHits, 2) +
    WEIGHTS.technicalTerms * saturate(technicalHits, 2) -
    WEIGHTS.simpleIndicators * saturate(simpleHits, 1) +
    WEIGHTS.multiStepPatterns * saturate(multiStepHits, 1) +
    WEIGHTS.questionComplexity * saturate(questionMarks - 1, 2) +
    WEIGHTS.attachedContext * saturate(attached, 3);

  let tier: ModelRoutingTier =
    score >= TIER_BOUNDARIES.complexReasoning
      ? "reasoning"
      : score >= TIER_BOUNDARIES.mediumComplex
        ? "complex"
        : score >= TIER_BOUNDARIES.simpleMedium
          ? "medium"
          : "simple";
  if (reasoningHits >= 2) tier = "reasoning";
  if (input.planMode && tierIndex(tier) < tierIndex("complex")) {
    tier = "complex";
    signals.push("plan mode");
  }

  return { tier, score, signals, continuation };
}

const tierIndex = (tier: ModelRoutingTier) => TIER_ORDER.indexOf(tier);

const effortOf = (selection: ModelSelection, optionId: string) =>
  selection.options?.find((option) => option.id === optionId)?.value;

function tierOfSelection(
  profile: ModelRoutingProfile,
  selection: ModelSelection,
): ModelRoutingTier | null {
  const effort = effortOf(selection, profile.effortOptionId);
  for (let index = TIER_ORDER.length - 1; index >= 0; index -= 1) {
    const tier = TIER_ORDER[index]!;
    const target = profile.tiers[tier];
    if (target.model === selection.model && target.effort === effort) return tier;
  }
  return null;
}

export interface AutoModelRoutingInput {
  readonly driver: string;
  readonly instanceId: ProviderInstanceId;
  readonly complexity: TurnComplexity;
  readonly current: ModelSelection | null | undefined;
  readonly threadStarted: boolean;
  readonly threadBusy: boolean;
  readonly availableModels: ReadonlyArray<string>;
  readonly tierOverrides?: ModelRoutingTierOverrides | undefined;
}

export interface AutoModelRoutingDecision {
  readonly selection: ModelSelection;
  readonly tier: ModelRoutingTier | null;
  readonly reason: "classified" | "escalate-only" | "continuation" | "busy" | "unmanaged";
}

export function resolveAutoModelSelection(
  input: AutoModelRoutingInput,
): AutoModelRoutingDecision | null {
  const baseProfile = MODEL_ROUTING_PROFILES[input.driver];
  if (!baseProfile) return null;
  const profile: ModelRoutingProfile = {
    ...baseProfile,
    tiers: { ...baseProfile.tiers, ...input.tierOverrides },
  };
  const current =
    input.current && input.current.instanceId === input.instanceId ? input.current : null;
  const currentTier = current ? tierOfSelection(profile, current) : null;

  if (current && input.threadBusy) return { selection: current, tier: currentTier, reason: "busy" };
  if (current && input.threadStarted && profile.escalateOnly && currentTier === null) {
    return { selection: current, tier: null, reason: "unmanaged" };
  }
  if (current && currentTier !== null && input.threadStarted && input.complexity.continuation) {
    return { selection: current, tier: currentTier, reason: "continuation" };
  }

  let tier = input.complexity.tier;
  let reason: AutoModelRoutingDecision["reason"] = "classified";
  if (
    profile.escalateOnly &&
    input.threadStarted &&
    currentTier !== null &&
    tierIndex(currentTier) > tierIndex(tier)
  ) {
    tier = currentTier;
    reason = "escalate-only";
  }

  const available = new Set(input.availableModels);
  const candidates = TIER_ORDER.slice(tierIndex(tier));
  for (let index = tierIndex(tier) - 1; index >= 0; index -= 1) {
    candidates.push(TIER_ORDER[index]!);
  }
  const resolvedTier = candidates.find((candidate) =>
    available.has(profile.tiers[candidate].model),
  );
  if (!resolvedTier) return current ? { selection: current, tier: currentTier, reason } : null;
  if (
    current &&
    profile.escalateOnly &&
    input.threadStarted &&
    currentTier !== null &&
    tierIndex(resolvedTier) < tierIndex(currentTier)
  ) {
    return { selection: current, tier: currentTier, reason: "escalate-only" };
  }

  if (current && currentTier === resolvedTier) {
    return { selection: current, tier: resolvedTier, reason };
  }
  const target = profile.tiers[resolvedTier];
  return {
    selection: createModelSelection(input.instanceId, target.model, [
      { id: profile.effortOptionId, value: target.effort },
    ]),
    tier: resolvedTier,
    reason,
  };
}
