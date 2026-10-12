import { JiraSiteId, type JiraIssueDetail, type JiraIssueSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildBoardColumns,
  groupIssuesByStatus,
  initialsOf,
  jiraIssueKind,
  jiraIssueThreadPrompt,
  jiraPriorityLevel,
  matchesIssueQuery,
  parseJiraIssueId,
  pickBoard,
} from "./jiraIssues.logic";

const issue = (
  key: string,
  status: [string, JiraIssueSummary["status"]["category"]],
  priority: string | null,
  updatedAt: string,
): JiraIssueSummary => ({
  siteId: JiraSiteId.make("naowee"),
  key,
  url: `https://naowee.atlassian.net/browse/${key}`,
  summary: `Summary ${key}`,
  status: { id: status[0], name: status[0], category: status[1] },
  priority: priority === null ? null : { id: priority, name: priority },
  issueType: { id: "1", name: "Task", subtask: false },
  project: { key: "ADN", name: "Analítica" },
  assignee: null,
  labels: ["datos"],
  parent: null,
  sprint: null,
  dueDate: null,
  createdAt: updatedAt,
  updatedAt,
});

describe("groupIssuesByStatus", () => {
  it("puts work in progress first, then to do, then done, ordering each by priority", () => {
    const groups = groupIssuesByStatus([
      issue("ADN-1", ["Done", "done"], "High", "2026-10-01T00:00:00Z"),
      issue("ADN-2", ["To Do", "todo"], "Low", "2026-10-05T00:00:00Z"),
      issue("ADN-3", ["In Progress", "in-progress"], "Medium", "2026-10-02T00:00:00Z"),
      issue("ADN-4", ["To Do", "todo"], "Highest", "2026-10-01T00:00:00Z"),
      issue("ADN-5", ["Canceled", "done"], null, "2026-10-09T00:00:00Z"),
      issue("ADN-6", ["to do", "todo"], "Low", "2026-10-07T00:00:00Z"),
    ]);

    expect(groups.map((group) => [group.status.name, group.issues.map((row) => row.key)])).toEqual([
      ["In Progress", ["ADN-3"]],
      ["To Do", ["ADN-4", "ADN-6", "ADN-2"]],
      ["Done", ["ADN-1"]],
      ["Canceled", ["ADN-5"]],
    ]);
  });
});

describe("jiraPriorityLevel", () => {
  it("reads default and Spanish priority names", () => {
    expect(
      ["Highest", "High", "Medium", "Low", "Lowest", "Más alta", "Media", "Baja", null].map(
        jiraPriorityLevel,
      ),
    ).toEqual(["urgent", "high", "medium", "low", "low", "urgent", "medium", "low", "none"]);
  });
});

describe("jiraIssueKind", () => {
  it("recognizes issue types by name in English and Spanish", () => {
    expect(
      [
        { name: "Bug", subtask: false },
        { name: "Historia", subtask: false },
        { name: "Épica", subtask: false },
        { name: "Tarea", subtask: false },
        { name: "Subtarea", subtask: true },
        { name: "Iniciativa", subtask: false },
      ].map(jiraIssueKind),
    ).toEqual(["bug", "story", "epic", "task", "subtask", "other"]);
  });
});

describe("matchesIssueQuery", () => {
  it("matches every term against the key, summary, project and labels", () => {
    const row = issue("ADN-12", ["To Do", "todo"], null, "2026-10-01T00:00:00Z");
    expect(matchesIssueQuery(row, "adn-12")).toBe(true);
    expect(matchesIssueQuery(row, "summary datos")).toBe(true);
    expect(matchesIssueQuery(row, "analítica otro")).toBe(false);
  });
});

describe("parseJiraIssueId", () => {
  it("splits the site from the key and rejects partial ids", () => {
    expect(parseJiraIssueId("naowee/ADN-1")).toEqual({ siteId: "naowee", key: "ADN-1" });
    expect(parseJiraIssueId("naowee/")).toBeNull();
    expect(parseJiraIssueId(undefined)).toBeNull();
  });
});

describe("jiraIssueThreadPrompt", () => {
  it("hands the agent the issue's link, facts, description and sub-tasks", () => {
    const detail: JiraIssueDetail = {
      ...issue("ADN-7", ["In Progress", "in-progress"], "High", "2026-10-01T00:00:00Z"),
      description: "Cargar los eventos a **BigQuery**.",
      reporter: null,
      subtasks: [
        {
          key: "ADN-8",
          summary: "Esquema",
          status: { id: "1", name: "Done", category: "done" },
        },
      ],
      comments: [],
      commentCount: 0,
      transitions: [],
      priorities: [],
    };

    expect(jiraIssueThreadPrompt(detail)).toBe(
      [
        "Jira issue [ADN-7](https://naowee.atlassian.net/browse/ADN-7): Summary ADN-7",
        "Status: In Progress · Priority: High · Type: Task · Labels: datos",
        "Cargar los eventos a **BigQuery**.",
        "Sub-tasks:\n- ADN-8 Esquema (Done)",
      ].join("\n\n") + "\n\n",
    );
  });
});

describe("initialsOf", () => {
  it("uses the first and last name", () => {
    expect(initialsOf("Jorge Esteban Borja")).toBe("JB");
    expect(initialsOf("naowee")).toBe("N");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("buildBoardColumns", () => {
  const board = {
    id: "7",
    name: "DEP board",
    columns: [
      {
        name: "Backlog",
        statuses: [{ id: "Backlog", name: "Backlog", category: "todo" as const }],
      },
      {
        name: "In Progress",
        statuses: [{ id: "In Progress", name: "In Progress", category: "in-progress" as const }],
      },
      {
        name: "Done",
        statuses: [
          { id: "Done", name: "Done", category: "done" as const },
          { id: "Canceled", name: "Canceled", category: "done" as const },
        ],
      },
    ],
  };

  it("keeps every board column, empty ones included, and gives stray statuses their own", () => {
    const columns = buildBoardColumns(
      [
        issue("DEP-1", ["In Progress", "in-progress"], "High", "2026-10-01T00:00:00Z"),
        issue("DEP-2", ["Canceled", "done"], null, "2026-10-02T00:00:00Z"),
        issue("DEP-3", ["Code Review", "in-progress"], null, "2026-10-03T00:00:00Z"),
      ],
      board,
    );
    expect(columns.map((column) => [column.name, column.issues.map((row) => row.key)])).toEqual([
      ["Backlog", []],
      ["In Progress", ["DEP-1"]],
      ["Done", ["DEP-2"]],
      ["Code Review", ["DEP-3"]],
    ]);
  });

  it("shows a card in the column it was dropped on until the move is confirmed", () => {
    const row = issue("DEP-1", ["Backlog", "todo"], null, "2026-10-01T00:00:00Z");
    const columns = buildBoardColumns(
      [row],
      board,
      new Map([["naowee/DEP-1", "column:1:In Progress"]]),
    );
    expect(columns.map((column) => column.issues.length)).toEqual([0, 1, 0]);
  });

  it("falls back to one column per status without a board", () => {
    const columns = buildBoardColumns(
      [
        issue("ADN-1", ["To Do", "todo"], null, "2026-10-01T00:00:00Z"),
        issue("ADN-2", ["In Progress", "in-progress"], null, "2026-10-01T00:00:00Z"),
      ],
      null,
    );
    expect(columns.map((column) => column.name)).toEqual(["In Progress", "To Do"]);
  });
});

describe("pickBoard", () => {
  const status = (id: string, category: "todo" | "in-progress" | "done") => ({
    id,
    name: id,
    category,
  });
  const qa = {
    id: "7",
    name: "Cola QA",
    columns: [{ name: "Ready for QA", statuses: [status("Ready for QA", "in-progress")] }],
  };
  const dev = {
    id: "8",
    name: "Dev JIN 2026",
    columns: [
      { name: "Backlog", statuses: [status("Backlog", "todo")] },
      { name: "In Progress", statuses: [status("In Progress", "in-progress")] },
      { name: "Ready for QA", statuses: [status("Ready for QA", "in-progress")] },
      { name: "Done", statuses: [status("Done", "done")] },
    ],
  };
  const issues = [
    issue("DEP-1", ["In Progress", "in-progress"], null, "2026-10-01T00:00:00Z"),
    issue("DEP-2", ["Ready for QA", "in-progress"], null, "2026-10-01T00:00:00Z"),
  ];

  it("prefers the board that holds most of the issues on screen", () => {
    expect(pickBoard([qa, dev], issues, null)?.name).toBe("Dev JIN 2026");
  });

  it("keeps the board the user chose", () => {
    expect(pickBoard([qa, dev], issues, "7")?.name).toBe("Cola QA");
    expect(pickBoard([qa, dev], issues, "missing")?.name).toBe("Dev JIN 2026");
    expect(pickBoard([], issues, null)).toBeNull();
  });
});
