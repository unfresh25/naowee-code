import {
  JiraError,
  type JiraBoard,
  type JiraBoardInput,
  type JiraProjectBoards,
  type JiraTransitionsResult,
  type JiraComment,
  type JiraCreateIssueInput,
  type JiraCreateIssueResult,
  type JiraCreateOptions,
  type JiraCreateOptionsInput,
  type JiraIssueDetail,
  type JiraIssueLink,
  type JiraIssueRef,
  type JiraIssueSummary,
  type JiraListIssuesInput,
  type JiraListIssuesResult,
  type JiraPriority,
  type JiraSearchUsersInput,
  type JiraSearchUsersResult,
  type JiraSiteConfig,
  JiraSiteId,
  type JiraSiteStatus,
  type JiraSitesResult,
  type JiraStatus,
  type JiraStatusCategory,
  type JiraUpdateIssueInput,
  type JiraUser,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import { adfToMarkdown, markdownToAdf } from "./jiraAdf.ts";

const LIST_LIMIT = 100;
const COMMENT_LIMIT = 50;
const USER_SEARCH_LIMIT = 20;
const BOARD_LIMIT = 20;
const HEADER_SAFE = /^[\x21-\x7e]+$/u;
const SPRINT_FIELD_SCHEMA = "com.pyxis.greenhopper.jira:gh-sprint";

const SUMMARY_FIELDS = [
  "summary",
  "status",
  "priority",
  "issuetype",
  "project",
  "assignee",
  "labels",
  "parent",
  "duedate",
  "created",
  "updated",
];
const DETAIL_FIELDS = [...SUMMARY_FIELDS, "description", "reporter", "subtasks"];

const RawUser = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrls: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
});
type RawUser = typeof RawUser.Type;

const RawStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  statusCategory: Schema.optional(Schema.NullOr(Schema.Struct({ key: Schema.String }))),
});
type RawStatus = typeof RawStatus.Type;

const RawPriority = Schema.Struct({ id: Schema.String, name: Schema.String });

const RawIssueType = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  subtask: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

const RawProject = Schema.Struct({ key: Schema.String, name: Schema.String });

const RawLinkedIssue = Schema.Struct({
  key: Schema.String,
  fields: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        summary: Schema.optional(Schema.NullOr(Schema.String)),
        status: Schema.optional(Schema.NullOr(RawStatus)),
      }),
    ),
  ),
});
type RawLinkedIssue = typeof RawLinkedIssue.Type;

const RawIssue = Schema.Struct({
  key: Schema.String,
  fields: Schema.StructWithRest(
    Schema.Struct({
      summary: Schema.optional(Schema.NullOr(Schema.String)),
      status: Schema.optional(Schema.NullOr(RawStatus)),
      priority: Schema.optional(Schema.NullOr(RawPriority)),
      issuetype: Schema.optional(Schema.NullOr(RawIssueType)),
      project: Schema.optional(Schema.NullOr(RawProject)),
      assignee: Schema.optional(Schema.NullOr(RawUser)),
      reporter: Schema.optional(Schema.NullOr(RawUser)),
      labels: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
      parent: Schema.optional(Schema.NullOr(RawLinkedIssue)),
      subtasks: Schema.optional(Schema.NullOr(Schema.Array(RawLinkedIssue))),
      duedate: Schema.optional(Schema.NullOr(Schema.String)),
      created: Schema.optional(Schema.NullOr(Schema.String)),
      updated: Schema.optional(Schema.NullOr(Schema.String)),
      description: Schema.optional(Schema.Unknown),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
});
type RawIssue = typeof RawIssue.Type;

const decodeSprints = Schema.decodeUnknownOption(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      state: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
);

const RawFields = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    schema: Schema.optional(
      Schema.NullOr(Schema.Struct({ custom: Schema.optional(Schema.NullOr(Schema.String)) })),
    ),
  }),
);

const RawBoardPage = Schema.Struct({
  values: Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String })),
});

const RawBoardConfiguration = Schema.Struct({
  columnConfig: Schema.Struct({
    columns: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        statuses: Schema.optional(
          Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.String }))),
        ),
      }),
    ),
  }),
});

const RawSearchPage = Schema.Struct({
  issues: Schema.Array(RawIssue),
  nextPageToken: Schema.optional(Schema.NullOr(Schema.String)),
  isLast: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

const RawCommentPage = Schema.Struct({
  comments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      author: Schema.optional(Schema.NullOr(RawUser)),
      body: Schema.optional(Schema.Unknown),
      created: Schema.optional(Schema.NullOr(Schema.String)),
      updated: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  total: Schema.optional(Schema.NullOr(Schema.Number)),
});

const RawTransitions = Schema.Struct({
  transitions: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, to: RawStatus }),
  ),
});

const RawPriorityPage = Schema.Struct({ values: Schema.Array(RawPriority) });

const RawProjectPage = Schema.Struct({
  values: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      name: Schema.String,
      issueTypes: Schema.optional(Schema.NullOr(Schema.Array(RawIssueType))),
    }),
  ),
});

const RawCreatedIssue = Schema.Struct({ key: Schema.String });

const JiraErrorBodyJson = Schema.fromJsonString(
  Schema.Struct({
    errorMessages: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
    errors: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
  }),
);
const decodeJiraErrorBody = Schema.decodeUnknownOption(JiraErrorBodyJson);

export class JiraService extends Context.Service<
  JiraService,
  {
    readonly sites: Effect.Effect<JiraSitesResult, JiraError>;
    readonly listIssues: (
      input: JiraListIssuesInput,
    ) => Effect.Effect<JiraListIssuesResult, JiraError>;
    readonly issue: (input: JiraIssueRef) => Effect.Effect<JiraIssueDetail, JiraError>;
    readonly boards: (input: JiraBoardInput) => Effect.Effect<JiraProjectBoards, JiraError>;
    readonly transitions: (input: JiraIssueRef) => Effect.Effect<JiraTransitionsResult, JiraError>;
    readonly updateIssue: (input: JiraUpdateIssueInput) => Effect.Effect<void, JiraError>;
    readonly searchUsers: (
      input: JiraSearchUsersInput,
    ) => Effect.Effect<JiraSearchUsersResult, JiraError>;
    readonly createOptions: (
      input: JiraCreateOptionsInput,
    ) => Effect.Effect<JiraCreateOptions, JiraError>;
    readonly createIssue: (
      input: JiraCreateIssueInput,
    ) => Effect.Effect<JiraCreateIssueResult, JiraError>;
  }
>()("t3/jira/JiraService") {}

interface SiteEntry {
  readonly id: JiraSiteId;
  readonly label: string;
  readonly url: string;
  readonly origin: string | null;
  readonly email: string;
  readonly apiToken: string;
}

interface ReadySite extends SiteEntry {
  readonly origin: string;
}

export function jiraSiteOrigin(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function siteEntry(id: string, config: JiraSiteConfig): SiteEntry {
  const origin = jiraSiteOrigin(config.url);
  return {
    id: JiraSiteId.make(id),
    label: config.label ?? (origin === null ? config.url : new URL(origin).host),
    url: config.url,
    origin,
    email: config.email,
    apiToken: config.apiToken,
  };
}

const statusCategory = (status: RawStatus): JiraStatusCategory => {
  switch (status.statusCategory?.key) {
    case "indeterminate":
      return "in-progress";
    case "done":
      return "done";
    default:
      return "todo";
  }
};

const toStatus = (status: RawStatus): JiraStatus => ({
  id: status.id,
  name: status.name,
  category: statusCategory(status),
});

const UNKNOWN_STATUS: JiraStatus = { id: "", name: "Unknown", category: "todo" };

const toUser = (user: RawUser | null | undefined): JiraUser | null => {
  if (!user || user.accountId.trim().length === 0) return null;
  const avatars = user.avatarUrls ?? {};
  return {
    accountId: user.accountId,
    displayName: user.displayName?.trim() || "Unknown user",
    avatarUrl: avatars["48x48"] ?? avatars["32x32"] ?? avatars["24x24"] ?? null,
  };
};

const toLink = (issue: RawLinkedIssue): JiraIssueLink => ({
  key: issue.key,
  summary: issue.fields?.summary ?? "",
  status: issue.fields?.status ? toStatus(issue.fields.status) : null,
});

const issueUrl = (site: ReadySite, key: string) =>
  `${site.origin}/browse/${encodeURIComponent(key)}`;

function sprintName(value: unknown): string | null {
  const sprints = Option.getOrNull(decodeSprints(value)) ?? [];
  const sprint =
    sprints.find((candidate) => candidate.state === "active") ??
    sprints.find((candidate) => candidate.state === "future") ??
    sprints.at(-1);
  return sprint?.name ?? null;
}

function toSummary(site: ReadySite, issue: RawIssue, sprintField: string | null): JiraIssueSummary {
  const fields = issue.fields;
  const projectKey = issue.key.split("-")[0] ?? issue.key;
  return {
    siteId: site.id,
    key: issue.key,
    url: issueUrl(site, issue.key),
    summary: fields.summary ?? "",
    status: fields.status ? toStatus(fields.status) : UNKNOWN_STATUS,
    priority: fields.priority ? { id: fields.priority.id, name: fields.priority.name } : null,
    issueType: fields.issuetype
      ? {
          id: fields.issuetype.id,
          name: fields.issuetype.name,
          subtask: fields.issuetype.subtask ?? false,
        }
      : null,
    project: fields.project
      ? { key: fields.project.key, name: fields.project.name }
      : { key: projectKey, name: projectKey },
    assignee: toUser(fields.assignee),
    labels: fields.labels ?? [],
    parent: fields.parent ? toLink(fields.parent) : null,
    sprint: sprintField === null ? null : sprintName(fields[sprintField]),
    dueDate: fields.duedate ?? null,
    createdAt: fields.created ?? "",
    updatedAt: fields.updated ?? fields.created ?? "",
  };
}

const quoteJql = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const ISSUE_KEY = /^[a-z][a-z0-9_]*-\d+$/iu;

export function buildIssueJql(input: JiraListIssuesInput): string {
  const clauses: string[] = [];
  if (input.scope === "assigned") clauses.push("assignee = currentUser()");
  if (input.scope === "reported") clauses.push("reporter = currentUser()");
  clauses.push(
    input.includeDone ? "(statusCategory != Done OR updated >= -30d)" : "statusCategory != Done",
  );
  const text = (input.query ?? "").replace(/[+\-&|!(){}[\]^~*?\\:"/]/gu, " ").trim();
  if (text.length > 0 && !ISSUE_KEY.test(input.query?.trim() ?? "")) {
    clauses.push(`text ~ ${quoteJql(text)}`);
  }
  return `${clauses.join(" AND ")} ORDER BY updated DESC`;
}

const credentialsHint = "Update them in Settings → Integrations → Jira.";

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const configuredSites = serverSettings.getSettings.pipe(
    Effect.map((settings) =>
      Object.entries(settings.jiraSites)
        .filter(([, site]) => site.enabled)
        .map(([id, site]) => siteEntry(id, site)),
    ),
    Effect.mapError(
      (cause) =>
        new JiraError({
          operation: "settings",
          detail: "Could not read the Jira settings.",
          cause,
        }),
    ),
  );

  const readySite = (entry: SiteEntry): Effect.Effect<ReadySite, JiraError> => {
    if (entry.origin === null) {
      return Effect.fail(
        new JiraError({
          operation: "site",
          siteId: entry.id,
          detail: `${entry.label} is not a valid Jira URL.`,
        }),
      );
    }
    if (!HEADER_SAFE.test(entry.email) || !HEADER_SAFE.test(entry.apiToken)) {
      return Effect.fail(
        new JiraError({
          operation: "site",
          siteId: entry.id,
          detail: `${entry.label} is missing its email or API token. ${credentialsHint}`,
        }),
      );
    }
    return Effect.succeed({ ...entry, origin: entry.origin });
  };

  const siteById = (siteId: JiraSiteId) =>
    configuredSites.pipe(
      Effect.flatMap((sites) => {
        const entry = sites.find((site) => site.id === siteId);
        return entry === undefined
          ? Effect.fail(
              new JiraError({
                operation: "site",
                siteId,
                detail: "This Jira site is no longer configured.",
              }),
            )
          : readySite(entry);
      }),
    );

  const failedResponse = (
    site: ReadySite,
    operation: string,
    response: HttpClientResponse.HttpClientResponse,
  ) =>
    response.text.pipe(
      Effect.orElseSucceed(() => ""),
      Effect.flatMap((text) => {
        const body = Option.getOrNull(decodeJiraErrorBody(text));
        const reasons = [
          ...(body?.errorMessages ?? []),
          ...Object.entries(body?.errors ?? {}).map(([field, message]) => `${field}: ${message}`),
        ].filter((reason) => reason.trim().length > 0);
        const reason = reasons.join(" ");
        const detail =
          response.status === 401
            ? `${site.label} rejected the email or API token. ${credentialsHint}`
            : response.status === 403
              ? `${site.label} denied access${reason ? `: ${reason}` : "."}`
              : response.status === 404
                ? reason || `Not found on ${site.label}, or you have no access to it.`
                : response.status === 429
                  ? `${site.label} is rate limiting requests. Try again in a minute.`
                  : reason || `${site.label} returned HTTP ${response.status}.`;
        return Effect.fail(
          new JiraError({ operation, siteId: site.id, status: response.status, detail }),
        );
      }),
    );

  const send = (site: ReadySite, operation: string, request: HttpClientRequest.HttpClientRequest) =>
    httpClient
      .execute(
        request.pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.basicAuth(site.email, site.apiToken),
        ),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new JiraError({
              operation,
              siteId: site.id,
              detail: `Could not reach ${site.label}.`,
              cause,
            }),
        ),
        Effect.filterOrElse(
          (response) => response.status >= 200 && response.status < 300,
          (response) => failedResponse(site, operation, response),
        ),
      );

  const json = <S extends Schema.Decoder<unknown>>(
    site: ReadySite,
    operation: string,
    request: HttpClientRequest.HttpClientRequest,
    schema: S,
  ): Effect.Effect<S["Type"], JiraError> =>
    send(site, operation, request).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.mapError(
            (cause) =>
              new JiraError({
                operation,
                siteId: site.id,
                detail: `${site.label} sent a response Naowee Code could not read.`,
                cause,
              }),
          ),
        ),
      ),
    );

  const withBody = (
    site: ReadySite,
    operation: string,
    request: HttpClientRequest.HttpClientRequest,
    body: unknown,
  ) =>
    HttpClientRequest.bodyJson(body)(request).pipe(
      Effect.mapError(
        (cause) =>
          new JiraError({
            operation,
            siteId: site.id,
            detail: "Could not encode the Jira request.",
            cause,
          }),
      ),
    );

  const api = (site: ReadySite, path: string) => `${site.origin}/rest/api/3${path}`;
  const agile = (site: ReadySite, path: string) => `${site.origin}/rest/agile/1.0${path}`;

  const sprintFields = yield* Cache.make({
    capacity: 50,
    timeToLive: "30 minutes",
    lookup: (siteId: JiraSiteId) =>
      siteById(siteId).pipe(
        Effect.flatMap((site) =>
          json(site, "fields", HttpClientRequest.get(api(site, "/field")), RawFields),
        ),
        Effect.map(
          (fields) =>
            fields.find((field) => field.schema?.custom === SPRINT_FIELD_SCHEMA)?.id ?? null,
        ),
        Effect.orElseSucceed(() => null),
      ),
  });
  const issuePath = (key: string) => `/issue/${encodeURIComponent(key)}`;

  const myself = (site: ReadySite) =>
    json(site, "myself", HttpClientRequest.get(api(site, "/myself")), RawUser).pipe(
      Effect.map(toUser),
    );

  const priorities = (site: ReadySite) =>
    json(
      site,
      "priorities",
      HttpClientRequest.get(api(site, "/priority/search"), { urlParams: { maxResults: "100" } }),
      RawPriorityPage,
    ).pipe(
      Effect.map((page): ReadonlyArray<JiraPriority> =>
        page.values.map((priority) => ({ id: priority.id, name: priority.name })),
      ),
      Effect.orElseSucceed((): ReadonlyArray<JiraPriority> => []),
    );

  const searchSite = (site: ReadySite, jql: string) =>
    Effect.gen(function* () {
      const sprintField = yield* Cache.get(sprintFields, site.id);
      const request = yield* withBody(
        site,
        "listIssues",
        HttpClientRequest.post(api(site, "/search/jql")),
        {
          jql,
          maxResults: LIST_LIMIT,
          fields: sprintField === null ? SUMMARY_FIELDS : [...SUMMARY_FIELDS, sprintField],
        },
      );
      const page = yield* json(site, "listIssues", request, RawSearchPage);
      return {
        issues: page.issues.map((issue) => toSummary(site, issue, sprintField)),
        truncated: page.isLast === false || (page.nextPageToken ?? null) !== null,
      };
    });

  const siteStatus = (
    entry: SiteEntry,
    account: JiraUser | null,
    error: JiraError | null,
  ): JiraSiteStatus => ({
    siteId: entry.id,
    label: entry.label,
    url: entry.origin ?? entry.url,
    account,
    error: error?.detail ?? null,
  });

  const issue = (ref: JiraIssueRef) =>
    Effect.gen(function* () {
      const site = yield* siteById(ref.siteId);
      const path = issuePath(ref.key);
      const sprintField = yield* Cache.get(sprintFields, site.id);
      const fields = sprintField === null ? DETAIL_FIELDS : [...DETAIL_FIELDS, sprintField];
      const [raw, comments, transitions, sitePriorities] = yield* Effect.all(
        [
          json(
            site,
            "issue",
            HttpClientRequest.get(api(site, path), {
              urlParams: { fields: fields.join(",") },
            }),
            RawIssue,
          ),
          json(
            site,
            "comments",
            HttpClientRequest.get(api(site, `${path}/comment`), {
              urlParams: { orderBy: "-created", maxResults: String(COMMENT_LIMIT) },
            }),
            RawCommentPage,
          ),
          transitionsOf(site, ref.key),
          priorities(site),
        ],
        { concurrency: "unbounded" },
      );
      const ordered: JiraComment[] = [];
      for (let index = comments.comments.length - 1; index >= 0; index -= 1) {
        const comment = comments.comments[index]!;
        ordered.push({
          id: comment.id,
          author: toUser(comment.author),
          body: adfToMarkdown(comment.body),
          createdAt: comment.created ?? "",
          updatedAt: comment.updated ?? comment.created ?? "",
        });
      }
      return {
        ...toSummary(site, raw, sprintField),
        description: adfToMarkdown(raw.fields.description),
        reporter: toUser(raw.fields.reporter),
        subtasks: (raw.fields.subtasks ?? []).map(toLink),
        comments: ordered,
        commentCount: Math.max(comments.total ?? 0, ordered.length),
        transitions: transitions.transitions.map((transition) => ({
          id: transition.id,
          name: transition.name,
          to: toStatus(transition.to),
        })),
        priorities: sitePriorities,
      } satisfies JiraIssueDetail;
    });

  const transitionsOf = (site: ReadySite, key: string) =>
    json(
      site,
      "transitions",
      HttpClientRequest.get(api(site, `${issuePath(key)}/transitions`)),
      RawTransitions,
    );

  const applyChange = (site: ReadySite, input: JiraUpdateIssueInput) => {
    const path = issuePath(input.key);
    const change = input.change;
    switch (change._tag) {
      case "move":
        return transitionsOf(site, input.key).pipe(
          Effect.flatMap(({ transitions }) => {
            const transition = transitions.find((candidate) =>
              change.statusIds.includes(candidate.to.id),
            );
            return transition === undefined
              ? Effect.fail(
                  new JiraError({
                    operation: "move",
                    siteId: site.id,
                    detail:
                      transitions.length === 0
                        ? `${input.key} cannot change status from its current one.`
                        : `From its current status, ${input.key} can only move to ${[
                            ...new Set(transitions.map((candidate) => candidate.to.name)),
                          ].join(", ")}.`,
                  }),
                )
              : withBody(site, "move", HttpClientRequest.post(api(site, `${path}/transitions`)), {
                  transition: { id: transition.id },
                });
          }),
        );
      case "transition":
        return withBody(
          site,
          "transition",
          HttpClientRequest.post(api(site, `${path}/transitions`)),
          {
            transition: { id: change.transitionId },
          },
        );
      case "assignee":
        return withBody(site, "assign", HttpClientRequest.put(api(site, `${path}/assignee`)), {
          accountId: change.accountId,
        });
      case "priority":
        return withBody(site, "priority", HttpClientRequest.put(api(site, path)), {
          fields: { priority: { id: change.priorityId } },
        });
      case "summary":
        return withBody(site, "summary", HttpClientRequest.put(api(site, path)), {
          fields: { summary: change.summary },
        });
      case "comment":
        return withBody(site, "comment", HttpClientRequest.post(api(site, `${path}/comment`)), {
          body: markdownToAdf(change.body),
        });
    }
  };

  return JiraService.of({
    sites: Effect.gen(function* () {
      const entries = yield* configuredSites;
      const sites = yield* Effect.forEach(
        entries,
        (entry) =>
          readySite(entry).pipe(
            Effect.flatMap(myself),
            Effect.match({
              onFailure: (error) => siteStatus(entry, null, error),
              onSuccess: (account) => siteStatus(entry, account, null),
            }),
          ),
        { concurrency: "unbounded" },
      );
      return { sites };
    }),
    listIssues: (input) =>
      Effect.gen(function* () {
        const entries = yield* configuredSites;
        const selected =
          input.siteIds === undefined
            ? entries
            : entries.filter((entry) => input.siteIds?.includes(entry.id));
        const jql = buildIssueJql(input);
        const results = yield* Effect.forEach(
          selected,
          (entry) =>
            Effect.result(readySite(entry).pipe(Effect.flatMap((site) => searchSite(site, jql)))),
          { concurrency: "unbounded" },
        );
        const issues: JiraIssueSummary[] = [];
        const sites: JiraSiteStatus[] = [];
        let truncated = false;
        results.forEach((result, index) => {
          const entry = selected[index]!;
          if (result._tag === "Failure") {
            sites.push(siteStatus(entry, null, result.failure));
            return;
          }
          issues.push(...result.success.issues);
          truncated ||= result.success.truncated;
          sites.push(siteStatus(entry, null, null));
        });
        issues.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
        return { issues, sites, truncated };
      }),
    issue,
    transitions: (ref) =>
      siteById(ref.siteId).pipe(
        Effect.flatMap((site) => transitionsOf(site, ref.key)),
        Effect.map(({ transitions }) => ({
          transitions: transitions.map((transition) => ({
            id: transition.id,
            name: transition.name,
            to: toStatus(transition.to),
          })),
        })),
      ),
    boards: (input) =>
      Effect.gen(function* () {
        const site = yield* siteById(input.siteId);
        const page = yield* json(
          site,
          "boards",
          HttpClientRequest.get(agile(site, "/board"), {
            urlParams: { projectKeyOrId: input.projectKey, maxResults: String(BOARD_LIMIT) },
          }),
          RawBoardPage,
        ).pipe(
          Effect.catchIf(
            (error) => error.status === 404,
            () => Effect.succeed({ values: [] }),
          ),
        );
        if (page.values.length === 0) return { boards: [] };
        const [configurations, statuses] = yield* Effect.all(
          [
            Effect.forEach(
              page.values,
              (board) =>
                json(
                  site,
                  "boardConfiguration",
                  HttpClientRequest.get(agile(site, `/board/${board.id}/configuration`)),
                  RawBoardConfiguration,
                ).pipe(Effect.option),
              { concurrency: "unbounded" },
            ),
            json(
              site,
              "statuses",
              HttpClientRequest.get(api(site, "/status")),
              Schema.Array(RawStatus),
            ),
          ],
          { concurrency: "unbounded" },
        );
        const statusById = new Map(statuses.map((status) => [status.id, toStatus(status)]));
        const boards: JiraBoard[] = [];
        page.values.forEach((board, index) => {
          const configuration = configurations[index];
          if (configuration === undefined || Option.isNone(configuration)) return;
          const columns = configuration.value.columnConfig.columns
            .map((column) => ({
              name: column.name,
              statuses: (column.statuses ?? []).map(
                (status) => statusById.get(status.id) ?? { ...UNKNOWN_STATUS, id: status.id },
              ),
            }))
            .filter((column) => column.statuses.length > 0);
          if (columns.length > 0) {
            boards.push({ id: String(board.id), name: board.name, columns });
          }
        });
        return { boards };
      }),
    updateIssue: (input) =>
      Effect.gen(function* () {
        const site = yield* siteById(input.siteId);
        const request = yield* applyChange(site, input);
        yield* send(site, input.change._tag, request);
      }),
    searchUsers: (input) =>
      Effect.gen(function* () {
        const site = yield* siteById(input.siteId);
        const users = yield* json(
          site,
          "searchUsers",
          HttpClientRequest.get(api(site, "/user/assignable/search"), {
            urlParams: {
              issueKey: input.key,
              query: input.query,
              maxResults: String(USER_SEARCH_LIMIT),
            },
          }),
          Schema.Array(RawUser),
        );
        return {
          users: users.map(toUser).filter((user): user is JiraUser => user !== null),
        };
      }),
    createOptions: (input) =>
      Effect.gen(function* () {
        const site = yield* siteById(input.siteId);
        const [projects, sitePriorities] = yield* Effect.all(
          [
            json(
              site,
              "createOptions",
              HttpClientRequest.get(api(site, "/project/search"), {
                urlParams: { expand: "issueTypes", maxResults: "100", orderBy: "name" },
              }),
              RawProjectPage,
            ),
            priorities(site),
          ],
          { concurrency: "unbounded" },
        );
        return {
          projects: projects.values.map((project) => ({
            key: project.key,
            name: project.name,
            issueTypes: (project.issueTypes ?? [])
              .filter((type) => type.subtask !== true)
              .map((type) => ({ id: type.id, name: type.name, subtask: false })),
          })),
          priorities: sitePriorities,
        };
      }),
    createIssue: (input) =>
      Effect.gen(function* () {
        const site = yield* siteById(input.siteId);
        const assignee = input.assignToMe ? yield* myself(site) : null;
        const description = input.description?.trim() ?? "";
        const request = yield* withBody(
          site,
          "createIssue",
          HttpClientRequest.post(api(site, "/issue")),
          {
            fields: {
              project: { key: input.projectKey },
              issuetype: { id: input.issueTypeId },
              summary: input.summary,
              ...(description.length > 0 ? { description: markdownToAdf(description) } : {}),
              ...(input.priorityId === undefined ? {} : { priority: { id: input.priorityId } }),
              ...(assignee === null ? {} : { assignee: { accountId: assignee.accountId } }),
            },
          },
        );
        const created = yield* json(site, "createIssue", request, RawCreatedIssue);
        return { siteId: site.id, key: created.key, url: issueUrl(site, created.key) };
      }),
  });
});

export const layer = Layer.effect(JiraService, make);
