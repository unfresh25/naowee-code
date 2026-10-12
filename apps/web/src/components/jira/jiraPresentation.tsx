import type { JiraIssueType, JiraStatus, JiraUser } from "@t3tools/contracts";
import {
  BookmarkIcon,
  BugIcon,
  CheckIcon,
  CircleDotIcon,
  CornerDownRightIcon,
  ZapIcon,
} from "lucide-react";
import { useState, type SVGProps } from "react";

import { cn } from "~/lib/utils";

import {
  initialsOf,
  isCanceledStatus,
  jiraIssueKind,
  jiraPriorityLevel,
  type JiraIssueKind,
} from "./jiraIssues.logic";

export function JiraStatusGlyph({ status, className }: { status: JiraStatus; className?: string }) {
  const base = cn("size-3.5 shrink-0", className);
  if (isCanceledStatus(status)) {
    return (
      <svg viewBox="0 0 14 14" className={cn(base, "text-muted-foreground")} aria-hidden>
        <circle cx="7" cy="7" r="6" fill="currentColor" opacity="0.9" />
        <path
          d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4"
          stroke="var(--background)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (status.category === "done") {
    return (
      <svg viewBox="0 0 14 14" className={cn(base, "text-primary")} aria-hidden>
        <circle cx="7" cy="7" r="6" fill="currentColor" />
        <path
          d="M4.4 7.2l1.8 1.8 3.5-3.6"
          fill="none"
          stroke="var(--background)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (status.category === "in-progress") {
    return (
      <svg viewBox="0 0 14 14" className={cn(base, "text-warning")} aria-hidden>
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" className={cn(base, "text-muted-foreground")} aria-hidden>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function JiraPriorityGlyph({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const level = jiraPriorityLevel(name);
  const base = cn("size-3.5 shrink-0", className);
  if (level === "urgent") {
    return (
      <svg viewBox="0 0 14 14" className={cn(base, "text-destructive")} aria-hidden>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <path d="M7 3.8v4" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.1" r="0.95" fill="var(--background)" />
      </svg>
    );
  }
  if (level === "none") {
    return (
      <svg viewBox="0 0 14 14" className={cn(base, "text-muted-foreground/60")} aria-hidden>
        {[2.5, 6, 9.5].map((x) => (
          <rect key={x} x={x} y="6.25" width="2" height="1.5" rx="0.5" fill="currentColor" />
        ))}
      </svg>
    );
  }
  const filled = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <svg viewBox="0 0 14 14" className={cn(base, "text-muted-foreground")} aria-hidden>
      {[
        { x: 1.5, y: 8, height: 4 },
        { x: 5.75, y: 5, height: 7 },
        { x: 10, y: 2, height: 10 },
      ].map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width="2.5"
          height={bar.height}
          rx="0.75"
          fill="currentColor"
          opacity={index < filled ? 1 : 0.3}
        />
      ))}
    </svg>
  );
}

const KIND_STYLE: Record<JiraIssueKind, { Icon: typeof BugIcon; className: string }> = {
  bug: { Icon: BugIcon, className: "text-destructive" },
  story: { Icon: BookmarkIcon, className: "text-success" },
  task: { Icon: CheckIcon, className: "text-info" },
  epic: { Icon: ZapIcon, className: "text-primary" },
  subtask: { Icon: CornerDownRightIcon, className: "text-info" },
  other: { Icon: CircleDotIcon, className: "text-muted-foreground" },
};

export function JiraIssueTypeGlyph({
  type,
  className,
}: {
  type: Pick<JiraIssueType, "name" | "subtask"> | null;
  className?: string;
}) {
  const { Icon, className: tone } = KIND_STYLE[jiraIssueKind(type)];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", tone, className)} />;
}

export function JiraAvatar({ user, className }: { user: JiraUser | null; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const base = cn(
    "inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full",
    className,
  );
  if (user === null) {
    return (
      <span
        aria-hidden
        className={cn(base, "border border-dashed border-muted-foreground/50 bg-transparent")}
      />
    );
  }
  if (user.avatarUrl !== null && failedUrl !== user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        className={cn(base, "bg-muted object-cover")}
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(user.avatarUrl)}
      />
    );
  }
  return (
    <span aria-hidden className={cn(base, "bg-muted text-3xs font-medium text-muted-foreground")}>
      {initialsOf(user.displayName)}
    </span>
  );
}

export function JiraLogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden {...props}>
      <path d="M76 118c-4-4-10-4-13 1L1 245a7 7 0 0 0 6 10h88c3 0 5-1 6-4 19-39 8-98-25-133Z" />
      <path d="M122 4c-35 56-33 117-10 163l42 84c1 3 4 4 7 4h87a7 7 0 0 0 7-10L134 4c-2-5-9-5-12 0Z" />
    </svg>
  );
}

export function JiraBoardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="-4 -4 24 24" fill="none" aria-hidden {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2 3.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h2.833v-9zm4.333 0v9h3.334v-9zm4.834 0v9H14a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5zM0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2z"
      />
    </svg>
  );
}
