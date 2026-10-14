import { describe, expect, it } from "vite-plus/test";

import { briefTitle, eventPrepPrompt, focusThreadPrompt, verticalDate } from "./dailyBrief.logic";

describe("briefTitle", () => {
  it("names the brief after the weekday in the brief's language", () => {
    expect(briefTitle("2026-10-14", "en")).toEqual({ eyebrow: "The", title: "Wednesday Brief" });
    expect(briefTitle("2026-10-14", "es")).toEqual({ eyebrow: "El brief del", title: "miércoles" });
  });
});

describe("verticalDate", () => {
  it("prints the date the way the margin shows it", () => {
    expect(verticalDate("2026-10-14", "en")).toBe("14 OCT 2026");
    expect(verticalDate("2026-01-05", "es")).toBe("5 ENE 2026");
  });
});

describe("thread prompts", () => {
  it("hands the agent the focus with its first step and sources", () => {
    expect(
      focusThreadPrompt({
        title: "Draft the per-event dashboard proposal",
        detail: "DEP-453 is still In Progress.",
        draft: "1. Layout\n2. Questions",
        sources: [
          { kind: "jira", label: "DEP-453", url: "https://naowee.atlassian.net/browse/DEP-453" },
        ],
      }),
    ).toBe(
      [
        "From today's brief: Draft the per-event dashboard proposal",
        "DEP-453 is still In Progress.",
        "Starting point:\n1. Layout\n2. Questions",
        "Sources:\n- DEP-453 (https://naowee.atlassian.net/browse/DEP-453)",
        "Help me move this forward. Start from the starting point and ask me only what you cannot find in the sources.",
      ].join("\n\n"),
    );
  });

  it("asks for a meeting prep with time and context", () => {
    expect(
      eventPrepPrompt(
        { start: "09:00", end: "10:00", title: "Como vamos", detail: "Weekly sync.", url: null },
        "2026-10-14",
      ),
    ).toContain('Prep me for "Como vamos" today (2026-10-14) at 09:00–10:00.');
  });
});
