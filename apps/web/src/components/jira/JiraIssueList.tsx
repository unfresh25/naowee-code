import type { JiraIssueSummary } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { jiraIssueId, type JiraIssueGroup } from "./jiraIssues.logic";
import {
  JiraAvatar,
  JiraIssueTypeGlyph,
  JiraPriorityGlyph,
  JiraStatusGlyph,
} from "./jiraPresentation";

export function JiraIssueList({
  groups,
  collapsed,
  onToggleGroup,
  selectedId,
  showSite,
  siteLabels,
  onSelect,
}: {
  groups: ReadonlyArray<JiraIssueGroup>;
  collapsed: ReadonlySet<string>;
  onToggleGroup: (id: string) => void;
  selectedId: string | null;
  showSite: boolean;
  siteLabels: ReadonlyMap<string, string>;
  onSelect: (issue: JiraIssueSummary) => void;
}) {
  return (
    <div role="list" className="@container/jira-list flex flex-col pb-10">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.id);
        return (
          <section key={group.id} aria-label={group.status.name}>
            <button
              type="button"
              className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 border-b border-border/60 bg-muted/70 px-4 text-left text-xs font-medium backdrop-blur-sm"
              aria-expanded={!isCollapsed}
              onClick={() => onToggleGroup(group.id)}
            >
              <ChevronRightIcon
                aria-hidden
                className={cn(
                  "size-3 text-muted-foreground transition-transform duration-150",
                  !isCollapsed && "rotate-90",
                )}
              />
              <JiraStatusGlyph status={group.status} />
              <span>{group.status.name}</span>
              <span className="text-muted-foreground tabular-nums">{group.issues.length}</span>
            </button>
            {isCollapsed
              ? null
              : group.issues.map((issue) => (
                  <JiraIssueRow
                    key={jiraIssueId(issue)}
                    issue={issue}
                    selected={selectedId === jiraIssueId(issue)}
                    siteLabel={showSite ? (siteLabels.get(issue.siteId) ?? null) : null}
                    onSelect={onSelect}
                  />
                ))}
          </section>
        );
      })}
    </div>
  );
}

const JiraIssueRow = memo(function JiraIssueRow({
  issue,
  selected,
  siteLabel,
  onSelect,
}: {
  issue: JiraIssueSummary;
  selected: boolean;
  siteLabel: string | null;
  onSelect: (issue: JiraIssueSummary) => void;
}) {
  return (
    <button
      type="button"
      role="listitem"
      data-jira-issue={jiraIssueId(issue)}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(issue)}
      className={cn(
        "group/jira-row flex h-10 w-full items-center gap-3 border-b border-border/40 px-4 text-left outline-none",
        "hover:bg-accent/50 focus-visible:bg-accent/60",
        selected && "bg-accent hover:bg-accent",
      )}
    >
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <JiraPriorityGlyph name={issue.priority?.name} />
        </TooltipTrigger>
        <TooltipPopup side="top">{issue.priority?.name ?? "No priority"}</TooltipPopup>
      </Tooltip>
      <span className="w-[4.75rem] shrink-0 truncate font-mono text-xs tabular-nums text-muted-foreground">
        {issue.key}
      </span>
      <JiraStatusGlyph status={issue.status} />
      <JiraIssueTypeGlyph type={issue.issueType} className="hidden @md/jira-list:block" />
      <span className="min-w-0 flex-1 truncate text-sm">{issue.summary}</span>
      {issue.parent ? (
        <span className="hidden max-w-48 shrink truncate text-xs text-muted-foreground @3xl/jira-list:inline">
          {issue.parent.summary || issue.parent.key}
        </span>
      ) : null}
      {issue.labels.slice(0, 2).map((label) => (
        <span
          key={label}
          className="hidden h-5 max-w-28 shrink-0 items-center gap-1 truncate rounded-full border border-border px-2 text-2xs text-muted-foreground @2xl/jira-list:inline-flex"
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
          <span className="truncate">{label}</span>
        </span>
      ))}
      <span className="hidden shrink-0 text-xs text-muted-foreground @xl/jira-list:inline">
        {siteLabel ? `${siteLabel} · ` : ""}
        {issue.project.key}
      </span>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <JiraAvatar user={issue.assignee} />
        </TooltipTrigger>
        <TooltipPopup side="top">{issue.assignee?.displayName ?? "Unassigned"}</TooltipPopup>
      </Tooltip>
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {issue.updatedAt ? formatRelativeTimeLabel(issue.updatedAt) : ""}
      </span>
    </button>
  );
});
