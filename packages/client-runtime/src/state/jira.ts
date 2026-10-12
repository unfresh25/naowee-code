import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createJiraEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const issue = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:jira:issue",
    tag: WS_METHODS.jiraIssue,
    staleTimeMs: 30_000,
  });
  return {
    sites: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:sites",
      tag: WS_METHODS.jiraSites,
      staleTimeMs: 5 * 60_000,
    }),
    issues: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:issues",
      tag: WS_METHODS.jiraListIssues,
      staleTimeMs: 30_000,
      refreshIntervalMs: 2 * 60_000,
    }),
    issue,
    boards: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:boards",
      tag: WS_METHODS.jiraBoards,
      staleTimeMs: 10 * 60_000,
    }),
    transitions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:transitions",
      tag: WS_METHODS.jiraTransitions,
      staleTimeMs: 15_000,
    }),
    users: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:users",
      tag: WS_METHODS.jiraSearchUsers,
      staleTimeMs: 60_000,
    }),
    createOptions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:create-options",
      tag: WS_METHODS.jiraCreateOptions,
      staleTimeMs: 10 * 60_000,
    }),
    updateIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:update-issue",
      tag: WS_METHODS.jiraUpdateIssue,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(
            issue({ environmentId, input: { siteId: input.siteId, key: input.key } }),
          ),
        ),
    }),
    createIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:create-issue",
      tag: WS_METHODS.jiraCreateIssue,
    }),
  };
}
