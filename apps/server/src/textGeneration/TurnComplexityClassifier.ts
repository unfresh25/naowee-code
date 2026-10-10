import * as NodeOS from "node:os";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TextGenerationError } from "@t3tools/contracts";
import type { ModelRoutingTier } from "@t3tools/contracts/settings";

import * as ServerSettings from "../serverSettings.ts";
import { TextGeneration } from "./TextGeneration.ts";

const CLASSIFICATION_TIMEOUT = "15 seconds";

export interface TurnComplexityRequest {
  readonly prompt: string;
  readonly attachmentCount: number;
  readonly contextCount: number;
  readonly planMode: boolean;
}

export class TurnComplexityClassifier extends Context.Service<
  TurnComplexityClassifier,
  {
    readonly classify: (
      input: TurnComplexityRequest,
    ) => Effect.Effect<{ readonly tier: ModelRoutingTier }, TextGenerationError>;
  }
>()("t3/textGeneration/TurnComplexityClassifier") {}

const classificationError = (detail: string, cause?: unknown) =>
  new TextGenerationError({ operation: "classifyTurnComplexity", detail, cause });

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const textGeneration = yield* TextGeneration;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const classifyTurnComplexity = textGeneration.classifyTurnComplexity;

  return TurnComplexityClassifier.of({
    classify: (input) =>
      Effect.gen(function* () {
        if (!classifyTurnComplexity) {
          return yield* classificationError("Turn complexity classification is unavailable.");
        }
        const settings = yield* serverSettings.getSettings.pipe(
          Effect.mapError((cause) => classificationError("Could not read server settings.", cause)),
        );
        const result = yield* classifyTurnComplexity({
          cwd: NodeOS.tmpdir(),
          message: input.prompt,
          attachmentCount: input.attachmentCount,
          contextCount: input.contextCount,
          planMode: input.planMode,
          modelSelection: settings.textGenerationModelSelection,
        }).pipe(Effect.timeoutOption(CLASSIFICATION_TIMEOUT));
        if (Option.isNone(result)) {
          return yield* classificationError("Turn complexity classification timed out.");
        }
        return result.value;
      }),
  });
});

export const layer = Layer.effect(TurnComplexityClassifier, make);
