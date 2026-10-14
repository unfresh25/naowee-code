import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createDailyBriefEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const status = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:brief:status",
    tag: WS_METHODS.briefStatus,
    staleTimeMs: 30_000,
    refreshIntervalMs: 5 * 60_000,
  });
  return {
    status,
    artwork: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:brief:artwork",
      tag: WS_METHODS.briefArtwork,
      staleTimeMs: 24 * 60 * 60_000,
    }),
    generate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:brief:generate",
      tag: WS_METHODS.briefGenerate,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(status({ environmentId, input: {} }))),
    }),
  };
}
