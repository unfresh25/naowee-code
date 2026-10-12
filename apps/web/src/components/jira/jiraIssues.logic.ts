import type {
  JiraBoard,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraIssueType,
  JiraStatus,
  JiraStatusCategory,
} from "@t3tools/contracts";

export type JiraPriorityLevel = "urgent" | "high" | "medium" | "low" | "none";

const PRIORITY_PATTERNS: ReadonlyArray<readonly [JiraPriorityLevel, RegExp]> = [
  ["urgent", /highest|blocker|critical|urgent|m[aá]s alta|cr[ií]tica|bloqueante|urgente/iu],
  ["low", /lowest|trivial|m[aá]s baja/iu],
  ["high", /high|major|alta|mayor/iu],
  ["medium", /medium|normal|media/iu],
  ["low", /low|minor|baja|menor/iu],
];

export function jiraPriorityLevel(name: string | null | undefined): JiraPriorityLevel {
  if (!name) return "none";
  for (const [level, pattern] of PRIORITY_PATTERNS) {
    if (pattern.test(name)) return level;
  }
  return "medium";
}

const PRIORITY_RANK: Record<JiraPriorityLevel, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export type JiraIssueKind = "bug" | "story" | "task" | "epic" | "subtask" | "other";

export function jiraIssueKind(type: Pick<JiraIssueType, "name" | "subtask"> | null): JiraIssueKind {
  if (!type) return "other";
  if (type.subtask || /sub-?task|subtarea/iu.test(type.name)) return "subtask";
  if (/bug|error|defect|incidencia/iu.test(type.name)) return "bug";
  if (/epic|[eé]pica|epopeya/iu.test(type.name)) return "epic";
  if (/story|historia/iu.test(type.name)) return "story";
  if (/task|tarea/iu.test(type.name)) return "task";
  return "other";
}

export function isCanceledStatus(status: JiraStatus): boolean {
  return (
    status.category === "done" &&
    /cancel|descart|won'?t|rechaz|duplicate|duplicad/iu.test(status.name)
  );
}

const CATEGORY_ORDER: Record<JiraStatusCategory, number> = {
  "in-progress": 0,
  todo: 1,
  done: 2,
};

export interface JiraIssueGroup {
  readonly id: string;
  readonly status: JiraStatus;
  readonly issues: ReadonlyArray<JiraIssueSummary>;
}

function sortByPriority(issues: ReadonlyArray<JiraIssueSummary>): JiraIssueSummary[] {
  return issues.toSorted(
    (left, right) =>
      PRIORITY_RANK[jiraPriorityLevel(left.priority?.name)] -
        PRIORITY_RANK[jiraPriorityLevel(right.priority?.name)] ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

export function groupIssuesByStatus(
  issues: ReadonlyArray<JiraIssueSummary>,
): ReadonlyArray<JiraIssueGroup> {
  const groups = new Map<string, { status: JiraStatus; issues: JiraIssueSummary[] }>();
  for (const issue of issues) {
    const id = `${issue.status.category}:${issue.status.name.toLowerCase()}`;
    const group = groups.get(id);
    if (group) group.issues.push(issue);
    else groups.set(id, { status: issue.status, issues: [issue] });
  }
  return [...groups.entries()]
    .map(([id, group]) => ({
      id,
      status: group.status,
      issues: sortByPriority(group.issues),
    }))
    .toSorted(
      (left, right) =>
        CATEGORY_ORDER[left.status.category] - CATEGORY_ORDER[right.status.category] ||
        Number(isCanceledStatus(left.status)) - Number(isCanceledStatus(right.status)) ||
        left.status.name.localeCompare(right.status.name),
    );
}

export function matchesIssueQuery(issue: JiraIssueSummary, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [issue.key, issue.summary, issue.project.name, ...issue.labels]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function jiraIssueId(issue: Pick<JiraIssueSummary, "siteId" | "key">): string {
  return `${issue.siteId}/${issue.key}`;
}

export function parseJiraIssueId(
  value: string | undefined,
): { siteId: string; key: string } | null {
  if (!value) return null;
  const separator = value.lastIndexOf("/");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { siteId: value.slice(0, separator), key: value.slice(separator + 1) };
}

export function jiraIssueThreadPrompt(issue: JiraIssueDetail): string {
  const facts = [
    `Status: ${issue.status.name}`,
    issue.priority ? `Priority: ${issue.priority.name}` : null,
    issue.issueType ? `Type: ${issue.issueType.name}` : null,
    issue.assignee ? `Assignee: ${issue.assignee.displayName}` : null,
    issue.parent ? `Parent: ${issue.parent.key} ${issue.parent.summary}` : null,
    issue.labels.length > 0 ? `Labels: ${issue.labels.join(", ")}` : null,
  ].filter((fact): fact is string => fact !== null);
  const sections = [
    `Jira issue [${issue.key}](${issue.url}): ${issue.summary}`,
    facts.join(" · "),
    issue.description.trim(),
    issue.subtasks.length > 0
      ? `Sub-tasks:\n${issue.subtasks
          .map(
            (subtask) =>
              `- ${subtask.key} ${subtask.summary}${subtask.status ? ` (${subtask.status.name})` : ""}`,
          )
          .join("\n")}`
      : "",
  ].filter((section) => section.length > 0);
  return `${sections.join("\n\n")}\n\n`;
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words.at(-1)![0]] : [words[0]?.[0]];
  return letters.filter(Boolean).join("").toUpperCase() || "?";
}

export interface JiraBoardColumnView {
  readonly id: string;
  readonly name: string;
  readonly status: JiraStatus;
  readonly statusIds: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<JiraIssueSummary>;
}

export function buildBoardColumns(
  issues: ReadonlyArray<JiraIssueSummary>,
  board: JiraBoard | null,
  placements: ReadonlyMap<string, string> = new Map(),
): ReadonlyArray<JiraBoardColumnView> {
  const columns: Array<{
    id: string;
    name: string;
    status: JiraStatus;
    statusIds: ReadonlyArray<string>;
    issues: JiraIssueSummary[];
  }> = (board?.columns ?? []).map((column, index) => ({
    id: `column:${index}:${column.name}`,
    name: column.name,
    status: column.statuses[0]!,
    statusIds: column.statuses.map((status) => status.id),
    issues: [],
  }));
  const loose: JiraIssueSummary[] = [];
  for (const issue of issues) {
    const column = columns.find((candidate) => candidate.statusIds.includes(issue.status.id));
    if (column) column.issues.push(issue);
    else loose.push(issue);
  }
  for (const group of groupIssuesByStatus(loose)) {
    columns.push({
      id: `status:${group.id}`,
      name: group.status.name,
      status: group.status,
      statusIds: [...new Set(group.issues.map((issue) => issue.status.id))],
      issues: [...group.issues],
    });
  }
  for (const [issueId, columnId] of placements) {
    const target = columns.find((column) => column.id === columnId);
    const source = columns.find((column) =>
      column.issues.some((issue) => jiraIssueId(issue) === issueId),
    );
    if (!target || !source || target === source) continue;
    const index = source.issues.findIndex((issue) => jiraIssueId(issue) === issueId);
    target.issues.push(...source.issues.splice(index, 1));
  }
  return columns.map((column) => ({ ...column, issues: sortByPriority(column.issues) }));
}

export function pickBoard(
  boards: ReadonlyArray<JiraBoard>,
  issues: ReadonlyArray<JiraIssueSummary>,
  rememberedId: string | null,
): JiraBoard | null {
  const remembered = boards.find((board) => board.id === rememberedId);
  if (remembered) return remembered;
  let best: { board: JiraBoard; covered: number } | null = null;
  for (const board of boards) {
    const statusIds = new Set(
      board.columns.flatMap((column) => column.statuses.map((status) => status.id)),
    );
    const covered = issues.filter((issue) => statusIds.has(issue.status.id)).length;
    if (
      best === null ||
      covered > best.covered ||
      (covered === best.covered && board.columns.length > best.board.columns.length)
    ) {
      best = { board, covered };
    }
  }
  return best?.board ?? null;
}
