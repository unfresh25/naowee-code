import {
  DEFAULT_SERVER_SETTINGS,
  JiraSiteId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProjectId,
  type JiraIssueSummary,
  type PullRequestListEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  briefModelSelection,
  describeJiraIssues,
  describePullRequests,
  isBriefDue,
  scheduledMinutes,
  type LocalDay,
} from "./DailyBriefService.ts";

const day = (minutes: number): LocalDay => ({
  date: "2026-10-14",
  minutes,
  label: "Wednesday 14 October 2026",
  timeZone: "America/Bogota",
});

const settings = { enabled: true, time: "07:30", language: "es" as const, instructions: "" };

describe("isBriefDue", () => {
  it("waits for the scheduled time and writes one brief a day", () => {
    const base = { settings, hasBrief: false, generating: false, lastFailureAt: null, nowMs: 0 };
    expect(scheduledMinutes("07:30")).toBe(450);
    expect(isBriefDue({ ...base, day: day(449) })).toBe(false);
    expect(isBriefDue({ ...base, day: day(450) })).toBe(true);
    expect(isBriefDue({ ...base, day: day(900) })).toBe(true);
    expect(isBriefDue({ ...base, day: day(900), hasBrief: true })).toBe(false);
    expect(isBriefDue({ ...base, day: day(900), generating: true })).toBe(false);
    expect(isBriefDue({ ...base, day: day(900), settings: { ...settings, enabled: false } })).toBe(
      false,
    );
  });

  it("retries a failed brief only after a pause", () => {
    const failed = { settings, day: day(500), hasBrief: false, generating: false };
    expect(isBriefDue({ ...failed, lastFailureAt: 1_000, nowMs: 1_000 + 60_000 })).toBe(false);
    expect(isBriefDue({ ...failed, lastFailureAt: 1_000, nowMs: 1_000 + 30 * 60_000 })).toBe(true);
  });
});

describe("briefModelSelection", () => {
  it("uses the first enabled Claude instance", () => {
    const selection = briefModelSelection({
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("work-claude")]: {
          driver: ProviderDriverKind.make("claudeAgent"),
        },
      },
    });
    expect(selection.instanceId).toBe("work-claude");
    expect(selection.model).toBe("claude-sonnet-5-5");
  });
});

describe("brief context", () => {
  it("lists issues and pull requests with the facts the brief needs", () => {
    const issue: JiraIssueSummary = {
      siteId: JiraSiteId.make("naowee"),
      key: "DEP-453",
      url: "https://naowee.atlassian.net/browse/DEP-453",
      summary: "Dashboard por evento",
      status: { id: "3", name: "In Progress", category: "in-progress" },
      priority: { id: "2", name: "High" },
      issueType: null,
      project: { key: "DEP", name: "Deportes" },
      assignee: null,
      labels: [],
      parent: { key: "DEP-355", summary: "Incentivos", status: null },
      sprint: "Dev Naowee Sprint 1",
      dueDate: null,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-13T10:00:00Z",
    };
    expect(describeJiraIssues([issue])).toBe(
      "- DEP-453 [In Progress] (High) Dashboard por evento · epic: Incentivos · sprint: Dev Naowee Sprint 1 · updated 2026-10-13 · https://naowee.atlassian.net/browse/DEP-453",
    );

    const entry = {
      provider: "github",
      host: "github.com",
      projectId: ProjectId.make("p"),
      projectTitle: "sport-records",
      repository: "naowee/sport-records",
      number: 169,
      title: "Colombia cupo export",
      url: "https://github.com/naowee/sport-records/pull/169",
      author: { login: "edinson", name: null, avatarUrl: null },
      headBranch: "feat/cupo",
      baseBranch: "staging",
      state: "merged",
      isDraft: false,
      mergeability: "unknown",
      additions: 0,
      deletions: 0,
      createdAt: "2026-10-12T00:00:00Z",
      updatedAt: "2026-10-13T00:00:00Z",
      viewerReviewRequested: true,
      labels: [],
    } as unknown as PullRequestListEntry;
    expect(describePullRequests([entry], { "github.com": "jborja" })).toBe(
      "- naowee/sport-records#169 [merged] Colombia cupo export · review requested from you · by edinson · updated 2026-10-13 · https://github.com/naowee/sport-records/pull/169",
    );
  });
});
