import type { EnvironmentId, JiraIssueSummary } from "@t3tools/contracts";
import { IterationCcwIcon } from "lucide-react";
import { memo, useState } from "react";

import { cn } from "~/lib/utils";
import { jiraEnvironment } from "~/state/jira";
import { useEnvironmentQuery } from "~/state/query";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { jiraIssueId, type JiraBoardColumnView } from "./jiraIssues.logic";
import {
  JiraAvatar,
  JiraIssueTypeGlyph,
  JiraPriorityGlyph,
  JiraStatusGlyph,
} from "./jiraPresentation";

const DRAG_TYPE = "application/x-naowee-jira-issue";

export function JiraIssueBoard({
  environmentId,
  columns,
  selectedId,
  onSelect,
  onMove,
}: {
  environmentId: EnvironmentId;
  columns: ReadonlyArray<JiraBoardColumnView>;
  selectedId: string | null;
  onSelect: (issue: JiraIssueSummary) => void;
  onMove: (issue: JiraIssueSummary, column: JiraBoardColumnView) => void;
}) {
  const [dragging, setDragging] = useState<JiraIssueSummary | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const transitions = useEnvironmentQuery(
    dragging === null
      ? null
      : jiraEnvironment.transitions({
          environmentId,
          input: { siteId: dragging.siteId, key: dragging.key },
        }),
  ).data;
  const reachable =
    dragging === null || transitions === null
      ? null
      : new Set(transitions.transitions.map((transition) => transition.to.id));
  return (
    <div className="flex h-full min-h-0 gap-2.5 overflow-x-auto p-4">
      {columns.map((column) => {
        const isSource = dragging !== null && column.issues.includes(dragging);
        const blocked =
          dragging !== null &&
          !isSource &&
          reachable !== null &&
          !column.statusIds.some((statusId) => reachable.has(statusId));
        const droppable = dragging !== null && !isSource && !blocked;
        return (
          <section
            key={column.id}
            aria-label={column.name}
            className={cn(
              "flex w-72 min-w-72 flex-col rounded-xl bg-muted/40 transition-colors duration-100",
              droppable && target === column.id && "bg-accent ring-1 ring-ring/50",
              blocked && "opacity-40",
            )}
            onDragOver={(event) => {
              if (!droppable || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (target !== column.id) setTarget(column.id);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setTarget((current) => (current === column.id ? null : current));
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setTarget(null);
              if (dragging !== null && droppable) onMove(dragging, column);
              setDragging(null);
            }}
          >
            <header className="flex h-10 shrink-0 items-center gap-2 px-3 text-sm">
              <JiraStatusGlyph status={column.status} />
              <span className="truncate font-medium">{column.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {column.issues.length}
              </span>
            </header>
            <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {column.issues.map((issue) => (
                <JiraIssueCard
                  key={jiraIssueId(issue)}
                  issue={issue}
                  selected={selectedId === jiraIssueId(issue)}
                  dimmed={dragging === issue}
                  onSelect={onSelect}
                  onDragStart={() => setDragging(issue)}
                  onDragEnd={() => {
                    setDragging(null);
                    setTarget(null);
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const JiraIssueCard = memo(function JiraIssueCard({
  issue,
  selected,
  dimmed,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  issue: JiraIssueSummary;
  selected: boolean;
  dimmed: boolean;
  onSelect: (issue: JiraIssueSummary) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      data-jira-issue={jiraIssueId(issue)}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(issue)}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, jiraIssueId(issue));
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-left shadow-xs/5 outline-none",
        "cursor-grab hover:border-border focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        selected && "border-ring/60 ring-1 ring-ring/40",
        dimmed && "opacity-40",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <JiraIssueTypeGlyph type={issue.issueType} />
        <span className="font-mono tabular-nums">{issue.key}</span>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <JiraAvatar user={issue.assignee} />
          </TooltipTrigger>
          <TooltipPopup side="top">{issue.assignee?.displayName ?? "Unassigned"}</TooltipPopup>
        </Tooltip>
      </span>
      <span className="line-clamp-3 text-sm leading-snug">{issue.summary}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex h-5 items-center rounded-md border border-border/70 px-1" />
            }
          >
            <JiraPriorityGlyph name={issue.priority?.name} />
          </TooltipTrigger>
          <TooltipPopup side="top">{issue.priority?.name ?? "No priority"}</TooltipPopup>
        </Tooltip>
        {issue.parent ? (
          <span className="inline-flex h-5 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border/70 px-1.5 text-2xs text-muted-foreground">
            <span aria-hidden className="size-2 shrink-0 rounded-sm bg-primary/70" />
            <span className="truncate">{issue.parent.summary || issue.parent.key}</span>
          </span>
        ) : null}
        {issue.sprint ? (
          <span className="inline-flex h-5 min-w-0 items-center gap-1 rounded-md border border-border/70 px-1.5 text-2xs text-muted-foreground">
            <IterationCcwIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{issue.sprint}</span>
          </span>
        ) : null}
        {issue.labels.slice(0, 2).map((label) => (
          <span
            key={label}
            className="inline-flex h-5 min-w-0 items-center gap-1 rounded-md border border-border/70 px-1.5 text-2xs text-muted-foreground"
          >
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
            <span className="truncate">{label}</span>
          </span>
        ))}
      </span>
    </button>
  );
});
