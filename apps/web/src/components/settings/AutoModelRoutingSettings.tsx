import type { ProviderOptionChoice, ServerProvider } from "@t3tools/contracts";
import type { ModelRoutingTierOverrides } from "@t3tools/contracts/settings";
import {
  MODEL_ROUTING_PROFILES,
  MODEL_ROUTING_TIERS,
  modelRoutingEffortOptionId,
  resolveModelRoutingTiers,
  supportsModelRouting,
  type ModelRoutingTier,
} from "@t3tools/client-runtime/model-routing";

import {
  AUTO_MODEL_ROUTING_LEARNING_KEY,
  EMPTY_LEARNED_ROUTING_TERMS,
  LearnedRoutingTermsSchema,
} from "../../autoModelRoutingLearning";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const TIER_COPY: Record<ModelRoutingTier, { title: string; description: string }> = {
  simple: {
    title: "Simple",
    description: "Short questions, renames, typos and greetings.",
  },
  medium: {
    title: "Medium",
    description: "Everyday code changes with a few technical signals.",
  },
  complex: {
    title: "Complex",
    description: "Multi-file or technical work, attached context and plan mode.",
  },
  reasoning: {
    title: "Reasoning",
    description: "Analysis, design, trade-offs and step-by-step reasoning.",
  },
};

type TierOverridesByDriver = Readonly<Record<string, ModelRoutingTierOverrides>>;

export function AutoModelRoutingSettings(props: {
  enabled: boolean;
  tiers: TierOverridesByDriver;
  providers: ReadonlyArray<ServerProvider>;
  onEnabledChange: (enabled: boolean) => void;
  onTiersChange: (tiers: TierOverridesByDriver) => void;
}) {
  const [learnedTerms, setLearnedTerms] = useLocalStorage(
    AUTO_MODEL_ROUTING_LEARNING_KEY,
    EMPTY_LEARNED_ROUTING_TERMS,
    LearnedRoutingTermsSchema,
  );
  const learnedTermCount = Object.keys(learnedTerms).length;
  const routedProviders = props.providers.filter(
    (provider, index, all) =>
      supportsModelRouting(provider.driver) &&
      all.findIndex((candidate) => candidate.driver === provider.driver) === index,
  );

  return (
    <SettingsSection id="auto-model-routing" title="Auto model routing">
      <SettingsRow
        {...searchableSetting("auto-model-routing")}
        description="Pick the model and effort for each turn by request complexity. Claude only moves up within a thread; Codex adjusts every turn."
        control={
          <Switch
            checked={props.enabled}
            onCheckedChange={(checked) => props.onEnabledChange(Boolean(checked))}
            aria-label="Auto model routing"
          />
        }
      />
      {props.enabled ? (
        <SettingsRow
          title="Learned corrections"
          description={
            learnedTermCount === 0
              ? "Nothing learned yet. When you pick a different model than Auto, this device learns from the words in that message."
              : `${learnedTermCount} ${learnedTermCount === 1 ? "term" : "terms"} learned from your model picks on this device.`
          }
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={learnedTermCount === 0}
              onClick={() => setLearnedTerms(EMPTY_LEARNED_ROUTING_TERMS)}
            >
              Reset
            </Button>
          }
        />
      ) : null}
      {props.enabled
        ? routedProviders.map((provider) => (
            <ProviderTierRows
              key={provider.driver}
              provider={provider}
              overrides={props.tiers[provider.driver]}
              onOverridesChange={(overrides) => {
                const next = { ...props.tiers };
                if (Object.keys(overrides).length === 0) delete next[provider.driver];
                else next[provider.driver] = overrides;
                props.onTiersChange(next);
              }}
            />
          ))
        : null}
    </SettingsSection>
  );
}

function ProviderTierRows(props: {
  provider: ServerProvider;
  overrides: ModelRoutingTierOverrides | undefined;
  onOverridesChange: (overrides: ModelRoutingTierOverrides) => void;
}) {
  const { provider } = props;
  const tiers = resolveModelRoutingTiers(provider.driver, props.overrides);
  const effortOptionId = modelRoutingEffortOptionId(provider.driver);
  const defaults = MODEL_ROUTING_PROFILES[provider.driver]?.tiers;
  if (!tiers || !effortOptionId || !defaults) return null;
  const providerName = provider.displayName ?? provider.driver;

  const effortChoices = (modelSlug: string): ReadonlyArray<ProviderOptionChoice> => {
    const descriptor = provider.models
      .find((model) => model.slug === modelSlug)
      ?.capabilities?.optionDescriptors?.find((candidate) => candidate.id === effortOptionId);
    if (descriptor?.type !== "select") return [];
    const promptInjected = new Set(descriptor.promptInjectedValues ?? []);
    return descriptor.options.filter(
      (option) => !promptInjected.has(option.id) && option.id !== "ultracode",
    );
  };

  const setTier = (tier: ModelRoutingTier, target: { model: string; effort: string } | null) => {
    const next: { -readonly [K in ModelRoutingTier]?: { model: string; effort: string } } = {
      ...props.overrides,
    };
    const fallback = defaults[tier];
    if (target === null || (target.model === fallback.model && target.effort === fallback.effort)) {
      delete next[tier];
    } else {
      next[tier] = target;
    }
    props.onOverridesChange(next);
  };

  return (
    <>
      {MODEL_ROUTING_TIERS.map((tier) => {
        const target = tiers[tier];
        const fallback = defaults[tier];
        const isDefault = target.model === fallback.model && target.effort === fallback.effort;
        const models = provider.models.filter(
          (model) => !model.isLegacy || model.slug === target.model,
        );
        const modelLabel =
          provider.models.find((model) => model.slug === target.model)?.name ?? target.model;
        const efforts = effortChoices(target.model);
        const effortLabel =
          efforts.find((option) => option.id === target.effort)?.label ?? target.effort;
        return (
          <SettingsRow
            key={tier}
            title={`${providerName} · ${TIER_COPY[tier].title}`}
            description={TIER_COPY[tier].description}
            resetAction={
              isDefault ? null : (
                <SettingResetButton
                  label={`${providerName} ${TIER_COPY[tier].title.toLowerCase()} tier`}
                  onClick={() => setTier(tier, null)}
                />
              )
            }
            control={
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Select
                  value={target.model}
                  onValueChange={(value) => {
                    if (typeof value !== "string") return;
                    const nextEfforts = effortChoices(value);
                    const effort = nextEfforts.some((option) => option.id === target.effort)
                      ? target.effort
                      : (nextEfforts.find((option) => option.isDefault)?.id ??
                        nextEfforts[0]?.id ??
                        target.effort);
                    setTier(tier, { model: value, effort });
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-48"
                    aria-label={`${providerName} ${TIER_COPY[tier].title} model`}
                  >
                    <SelectValue>{modelLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {models.map((model) => (
                      <SelectItem hideIndicator key={model.slug} value={model.slug}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Select
                  value={target.effort}
                  onValueChange={(value) => {
                    if (typeof value !== "string") return;
                    setTier(tier, { model: target.model, effort: value });
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-28"
                    aria-label={`${providerName} ${TIER_COPY[tier].title} effort`}
                  >
                    <SelectValue>{effortLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {efforts.map((option) => (
                      <SelectItem hideIndicator key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            }
          />
        );
      })}
    </>
  );
}
