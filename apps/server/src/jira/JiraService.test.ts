import { assert, it } from "@effect/vitest";
import { JiraSiteId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http";
import { describe } from "vite-plus/test";

import * as ServerSettings from "../serverSettings.ts";
import { buildIssueJql, JiraService, layer } from "./JiraService.ts";

interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly params: Record<string, string>;
  readonly body: unknown;
  readonly authorization: string | undefined;
}

const NAOWEE = JiraSiteId.make("naowee");
const OTHER = JiraSiteId.make("other");

const adf = (value: string) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
});

const rawIssue = (key: string, updated: string, statusCategory = "indeterminate") => ({
  key,
  fields: {
    summary: `Summary ${key}`,
    status: { id: "3", name: "In Progress", statusCategory: { key: statusCategory } },
    priority: { id: "2", name: "High" },
    issuetype: { id: "10001", name: "Task", subtask: false },
    project: { key: key.split("-")[0], name: "Analítica" },
    assignee: {
      accountId: "acc-1",
      displayName: "Jorge Borja",
      avatarUrls: { "48x48": "https://avatar.example/48.png" },
    },
    labels: ["datos"],
    parent: null,
    duedate: null,
    created: "2026-10-01T10:00:00.000-0500",
    updated,
  },
});

function decodeBody(request: HttpClientRequest.HttpClientRequest): unknown {
  if (request.body._tag !== "Uint8Array") return undefined;
  return JSON.parse(new TextDecoder().decode(request.body.body));
}

function makeLayer(route: (request: SentRequest) => { status?: number; body?: unknown }) {
  const sent: SentRequest[] = [];
  const client = HttpClient.make((request) => {
    const entry: SentRequest = {
      method: request.method,
      url: request.url,
      params: Object.fromEntries(request.urlParams),
      body: decodeBody(request),
      authorization: request.headers["authorization"],
    };
    sent.push(entry);
    const answer = route(entry);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
          status: answer.status ?? 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });
  const testLayer = layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(
      ServerSettings.layerTest({
        jiraSites: {
          [NAOWEE]: {
            url: "naowee.atlassian.net",
            email: "me@naowee.com",
            apiToken: "token-1",
            enabled: true,
          },
          [OTHER]: {
            label: "Cliente",
            url: "https://cliente.atlassian.net/jira/your-work",
            email: "me@naowee.com",
            apiToken: "token-2",
            enabled: true,
          },
        },
      }),
    ),
  );
  return { sent, testLayer };
}

describe("JiraService", () => {
  it.effect("merges every site's issues and keeps a failing site from hiding the rest", () => {
    const { sent, testLayer } = makeLayer((request) =>
      request.url.startsWith("https://cliente.atlassian.net")
        ? { status: 401, body: { errorMessages: [] } }
        : {
            body: {
              issues: [
                rawIssue("ADN-1", "2026-10-02T10:00:00.000-0500"),
                rawIssue("ADN-2", "2026-10-05T10:00:00.000-0500", "new"),
              ],
              isLast: true,
            },
          },
    );
    return Effect.gen(function* () {
      const jira = yield* JiraService;
      const result = yield* jira.listIssues({ scope: "assigned", includeDone: false });

      assert.deepEqual(
        result.issues.map((issue) => [issue.key, issue.status.category, issue.url]),
        [
          ["ADN-2", "todo", "https://naowee.atlassian.net/browse/ADN-2"],
          ["ADN-1", "in-progress", "https://naowee.atlassian.net/browse/ADN-1"],
        ],
      );
      assert.equal(result.issues[0]?.assignee?.avatarUrl, "https://avatar.example/48.png");
      assert.isFalse(result.truncated);
      const failed = result.sites.find((site) => site.siteId === OTHER);
      assert.equal(failed?.url, "https://cliente.atlassian.net");
      assert.include(failed?.error ?? "", "Cliente rejected the email or API token");
      assert.isNull(result.sites.find((site) => site.siteId === NAOWEE)?.error ?? null);

      const search = sent.find(
        (request) => request.url === "https://naowee.atlassian.net/rest/api/3/search/jql",
      );
      assert.isDefined(search);
      assert.equal(search!.method, "POST");
      assert.equal(search!.url, "https://naowee.atlassian.net/rest/api/3/search/jql");
      assert.equal(
        search!.authorization,
        `Basic ${Buffer.from("me@naowee.com:token-1").toString("base64")}`,
      );
      assert.include((search!.body as { jql: string }).jql, "assignee = currentUser()");
    }).pipe(Effect.provide(testLayer));
  });

  it.effect(
    "reads an issue with markdown description, chronological comments and transitions",
    () => {
      const { testLayer } = makeLayer((request) => {
        if (request.url.endsWith("/comment")) {
          return {
            body: {
              comments: [
                { id: "2", body: adf("segundo"), created: "2026-10-03T00:00:00.000Z" },
                { id: "1", body: adf("primero"), created: "2026-10-02T00:00:00.000Z" },
              ],
              total: 2,
            },
          };
        }
        if (request.url.endsWith("/transitions")) {
          return {
            body: {
              transitions: [
                {
                  id: "31",
                  name: "Done",
                  to: { id: "4", name: "Done", statusCategory: { key: "done" } },
                },
              ],
            },
          };
        }
        if (request.url.endsWith("/priority/search")) {
          return {
            body: {
              values: [
                { id: "1", name: "Highest" },
                { id: "2", name: "High" },
              ],
            },
          };
        }
        const issue = rawIssue("ADN-7", "2026-10-03T00:00:00.000Z");
        return {
          body: {
            ...issue,
            fields: {
              ...issue.fields,
              description: adf("Cargar los eventos"),
              subtasks: [{ key: "ADN-8", fields: { summary: "Sub", status: null } }],
            },
          },
        };
      });
      return Effect.gen(function* () {
        const jira = yield* JiraService;
        const detail = yield* jira.issue({ siteId: NAOWEE, key: "ADN-7" });

        assert.equal(detail.description, "Cargar los eventos");
        assert.deepEqual(
          detail.comments.map((comment) => comment.body),
          ["primero", "segundo"],
        );
        assert.equal(detail.commentCount, 2);
        assert.deepEqual(detail.transitions, [
          { id: "31", name: "Done", to: { id: "4", name: "Done", category: "done" } },
        ]);
        assert.deepEqual(
          detail.priorities.map((priority) => priority.name),
          ["Highest", "High"],
        );
        assert.deepEqual(detail.subtasks, [{ key: "ADN-8", summary: "Sub", status: null }]);
      }).pipe(Effect.provide(testLayer));
    },
  );

  it.effect("posts a comment as a Jira document", () => {
    const { sent, testLayer } = makeLayer(() => ({ status: 201, body: { id: "9" } }));
    return Effect.gen(function* () {
      const jira = yield* JiraService;
      yield* jira.updateIssue({
        siteId: NAOWEE,
        key: "ADN-7",
        change: { _tag: "comment", body: "Listo en **stg**" },
      });

      assert.lengthOf(sent, 1);
      const posted = sent.find((request) => request.method === "POST");
      assert.equal(posted?.url, "https://naowee.atlassian.net/rest/api/3/issue/ADN-7/comment");
      assert.deepEqual(posted?.body, {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Listo en " },
                { type: "text", text: "stg", marks: [{ type: "strong" }] },
              ],
            },
          ],
        },
      });
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("creates an issue assigned to the signed-in account", () => {
    const { sent, testLayer } = makeLayer((request) =>
      request.url.endsWith("/myself")
        ? { body: { accountId: "acc-1", displayName: "Jorge Borja" } }
        : { status: 201, body: { id: "100", key: "ADN-99" } },
    );
    return Effect.gen(function* () {
      const jira = yield* JiraService;
      const created = yield* jira.createIssue({
        siteId: NAOWEE,
        projectKey: "ADN",
        issueTypeId: "10001",
        summary: "Nuevo tablero",
        assignToMe: true,
      });

      assert.deepEqual(created, {
        siteId: NAOWEE,
        key: "ADN-99",
        url: "https://naowee.atlassian.net/browse/ADN-99",
      });
      assert.deepEqual(sent.find((request) => request.method === "POST")?.body, {
        fields: {
          project: { key: "ADN" },
          issuetype: { id: "10001" },
          summary: "Nuevo tablero",
          assignee: { accountId: "acc-1" },
        },
      });
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("reads the active sprint from the site's sprint field", () => {
    const { sent, testLayer } = makeLayer((request) => {
      if (request.url.endsWith("/field")) {
        return {
          body: [
            { id: "summary", schema: { type: "string" } },
            {
              id: "customfield_10020",
              schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" },
            },
          ],
        };
      }
      const issue = rawIssue("DEP-376", "2026-10-02T10:00:00.000-0500");
      return {
        body: {
          issues: [
            {
              ...issue,
              fields: {
                ...issue.fields,
                customfield_10020: [
                  { id: 1, name: "Dev Naowee Sprint 0", state: "closed" },
                  { id: 2, name: "Dev Naowee Sprint 1", state: "active" },
                ],
              },
            },
          ],
          isLast: true,
        },
      };
    });
    return Effect.gen(function* () {
      const jira = yield* JiraService;
      const result = yield* jira.listIssues({
        siteIds: [NAOWEE],
        scope: "assigned",
        includeDone: false,
      });

      assert.equal(result.issues[0]?.sprint, "Dev Naowee Sprint 1");
      const search = sent.find((request) => request.url.endsWith("/search/jql"));
      assert.isDefined(search);
      assert.include((search!.body as { fields: string[] }).fields, "customfield_10020");
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("returns every board of the project with its columns in order", () => {
    const { testLayer } = makeLayer((request) => {
      if (request.url.endsWith("/rest/agile/1.0/board")) {
        return {
          body: {
            values: [
              { id: 7, name: "Cola QA" },
              { id: 8, name: "Dev JIN 2026" },
              { id: 9, name: "Broken" },
            ],
          },
        };
      }
      if (request.url.endsWith("/board/7/configuration")) {
        return {
          body: {
            columnConfig: { columns: [{ name: "Ready for QA", statuses: [{ id: "6" }] }] },
          },
        };
      }
      if (request.url.endsWith("/board/8/configuration")) {
        return {
          body: {
            columnConfig: {
              columns: [
                { name: "Backlog", statuses: [{ id: "1" }] },
                { name: "In Progress", statuses: [{ id: "3" }] },
                { name: "Unmapped", statuses: [] },
                { name: "Done", statuses: [{ id: "4" }, { id: "5" }] },
              ],
            },
          },
        };
      }
      if (request.url.endsWith("/board/9/configuration")) return { status: 403, body: {} };
      return {
        body: [
          { id: "1", name: "Backlog", statusCategory: { key: "new" } },
          { id: "3", name: "In Progress", statusCategory: { key: "indeterminate" } },
          { id: "4", name: "Done", statusCategory: { key: "done" } },
          { id: "5", name: "Won't do", statusCategory: { key: "done" } },
          { id: "6", name: "Ready for QA", statusCategory: { key: "indeterminate" } },
        ],
      };
    });
    return Effect.gen(function* () {
      const jira = yield* JiraService;
      const { boards } = yield* jira.boards({ siteId: NAOWEE, projectKey: "DEP" });

      assert.deepEqual(
        boards.map((board) => [
          board.name,
          board.columns.map(
            (column) =>
              `${column.name}=${column.statuses.map((status) => `${status.name}:${status.category}`).join("+")}`,
          ),
        ]),
        [
          ["Cola QA", ["Ready for QA=Ready for QA:in-progress"]],
          [
            "Dev JIN 2026",
            [
              "Backlog=Backlog:todo",
              "In Progress=In Progress:in-progress",
              "Done=Done:done+Won't do:done",
            ],
          ],
        ],
      );
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("has no boards for a project without one", () => {
    const { testLayer } = makeLayer(() => ({ body: { values: [] } }));
    return Effect.gen(function* () {
      const jira = yield* JiraService;
      assert.deepEqual(yield* jira.boards({ siteId: NAOWEE, projectKey: "OPS" }), { boards: [] });
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("moves an issue through the transition that reaches the target column", () => {
    const { sent, testLayer } = makeLayer((request) =>
      request.method === "GET"
        ? {
            body: {
              transitions: [
                {
                  id: "11",
                  name: "Start",
                  to: { id: "3", name: "In Progress", statusCategory: { key: "indeterminate" } },
                },
                {
                  id: "31",
                  name: "Finish",
                  to: { id: "4", name: "Done", statusCategory: { key: "done" } },
                },
              ],
            },
          }
        : { status: 204 },
    );
    return Effect.gen(function* () {
      const jira = yield* JiraService;
      yield* jira.updateIssue({
        siteId: NAOWEE,
        key: "DEP-376",
        change: { _tag: "move", statusIds: ["5", "4"] },
      });
      assert.deepEqual(sent.find((request) => request.method === "POST")?.body, {
        transition: { id: "31" },
      });
      const { transitions } = yield* jira.transitions({ siteId: NAOWEE, key: "DEP-376" });
      assert.deepEqual(
        transitions.map((transition) => `${transition.name}->${transition.to.id}`),
        ["Start->3", "Finish->4"],
      );

      const error = yield* Effect.flip(
        jira.updateIssue({
          siteId: NAOWEE,
          key: "DEP-376",
          change: { _tag: "move", statusIds: ["9"] },
        }),
      );
      assert.equal(
        error.detail,
        "From its current status, DEP-376 can only move to In Progress, Done.",
      );
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("explains a site saved without credentials instead of calling it", () => {
    const { sent, testLayer } = makeLayer(() => ({ body: {} }));
    return Effect.gen(function* () {
      const jira = yield* JiraService;
      const error = yield* Effect.flip(jira.issue({ siteId: JiraSiteId.make("gone"), key: "X-1" }));
      assert.equal(error.detail, "This Jira site is no longer configured.");
      assert.lengthOf(sent, 0);
    }).pipe(Effect.provide(testLayer));
  });
});

describe("buildIssueJql", () => {
  it("narrows by scope and done state, and searches text safely", () => {
    assert.equal(
      buildIssueJql({
        scope: "reported",
        includeDone: true,
        query: 'pipeline "eventos" (stg)',
      }),
      'reporter = currentUser() AND (statusCategory != Done OR updated >= -30d) AND text ~ "pipeline  eventos   stg" ORDER BY updated DESC',
    );
  });

  it("leaves an issue key to the client filter so an unknown key cannot break the query", () => {
    assert.equal(
      buildIssueJql({ scope: "all", includeDone: false, query: "ADN-12" }),
      "statusCategory != Done ORDER BY updated DESC",
    );
  });
});
