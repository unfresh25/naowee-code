import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  JiraIssueChange,
  JiraIssueDetail as JiraIssueDetailData,
  JiraSiteId,
  JiraUser,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  MessageSquarePlusIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { jiraEnvironment } from "~/state/jira";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { jiraIssueThreadPrompt } from "./jiraIssues.logic";
import {
  JiraAvatar,
  JiraIssueTypeGlyph,
  JiraPriorityGlyph,
  JiraStatusGlyph,
} from "./jiraPresentation";

const ThreadProjectChoices = Schema.Record(Schema.String, Schema.String);
const THREAD_PROJECT_STORAGE_KEY = "naowee:jira:thread-projects-v1";
const EMPTY_CHOICES: Readonly<Record<string, string>> = {};

export function JiraIssueDetail({
  environmentId,
  siteId,
  issueKey,
  account,
  onChanged,
  onClose,
  onOpenIssue,
}: {
  environmentId: EnvironmentId;
  siteId: JiraSiteId;
  issueKey: string;
  account: JiraUser | null;
  onChanged: () => void;
  onClose: () => void;
  onOpenIssue: (key: string) => void;
}) {
  const query = useEnvironmentQuery(
    jiraEnvironment.issue({ environmentId, input: { siteId, key: issueKey } }),
  );
  const updateIssue = useAtomCommand(jiraEnvironment.updateIssue, { label: "update Jira issue" });
  const [pending, setPending] = useState<JiraIssueChange["_tag"] | null>(null);
  const detail = query.data;

  const change = async (next: JiraIssueChange) => {
    setPending(next._tag);
    try {
      const result = await updateIssue({
        environmentId,
        input: { siteId, key: issueKey, change: next },
      });
      if (result._tag === "Success") onChanged();
      return result._tag === "Success";
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <span className="font-mono text-xs text-muted-foreground">{issueKey}</span>
        {detail ? (
          <span className="truncate text-xs text-muted-foreground">· {detail.project.name}</span>
        ) : null}
        <div className="flex-1" />
        {detail ? <StartThreadButton detail={detail} /> : null}
        {detail ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Open in Jira"
            render={<a href={detail.url} target="_blank" rel="noreferrer" />}
          >
            <ArrowUpRightIcon />
          </Button>
        ) : null}
        <Button size="icon-xs" variant="ghost" aria-label="Close issue" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {detail === null ? (
          query.error ? (
            <p className="p-6 text-sm text-muted-foreground">{query.error}</p>
          ) : (
            <DetailSkeleton />
          )
        ) : (
          <div className="flex flex-col gap-6 px-6 py-5">
            <EditableSummary
              key={detail.summary}
              summary={detail.summary}
              saving={pending === "summary"}
              onSave={(summary) => change({ _tag: "summary", summary })}
            />
            <div className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
              <PropertyLabel>Status</PropertyLabel>
              <StatusMenu
                detail={detail}
                busy={pending === "transition"}
                onTransition={(transitionId) => void change({ _tag: "transition", transitionId })}
              />
              <PropertyLabel>Priority</PropertyLabel>
              <PriorityMenu
                detail={detail}
                busy={pending === "priority"}
                onPriority={(priorityId) => void change({ _tag: "priority", priorityId })}
              />
              <PropertyLabel>Assignee</PropertyLabel>
              <AssigneePicker
                environmentId={environmentId}
                detail={detail}
                account={account}
                busy={pending === "assignee"}
                onAssign={(accountId) => void change({ _tag: "assignee", accountId })}
              />
              <PropertyLabel>Type</PropertyLabel>
              <span className="flex items-center gap-2 px-2">
                <JiraIssueTypeGlyph type={detail.issueType} />
                {detail.issueType?.name ?? "—"}
              </span>
              {detail.parent ? (
                <>
                  <PropertyLabel>Parent</PropertyLabel>
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
                    onClick={() => onOpenIssue(detail.parent!.key)}
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {detail.parent.key}
                    </span>
                    <span className="truncate">{detail.parent.summary}</span>
                  </button>
                </>
              ) : null}
              {detail.labels.length > 0 ? (
                <>
                  <PropertyLabel>Labels</PropertyLabel>
                  <span className="flex flex-wrap gap-1 px-2">
                    {detail.labels.map((label) => (
                      <span
                        key={label}
                        className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-2xs text-muted-foreground"
                      >
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-muted-foreground/60"
                        />
                        {label}
                      </span>
                    ))}
                  </span>
                </>
              ) : null}
              {detail.dueDate ? (
                <>
                  <PropertyLabel>Due</PropertyLabel>
                  <span className="px-2 tabular-nums">{detail.dueDate}</span>
                </>
              ) : null}
              {detail.reporter ? (
                <>
                  <PropertyLabel>Reporter</PropertyLabel>
                  <span className="flex items-center gap-2 px-2">
                    <JiraAvatar user={detail.reporter} className="size-4" />
                    {detail.reporter.displayName}
                  </span>
                </>
              ) : null}
            </div>

            <section className="flex flex-col gap-2">
              {detail.description.trim().length > 0 ? (
                <ChatMarkdown text={detail.description} cwd={undefined} className="text-sm" />
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}
            </section>

            {detail.subtasks.length > 0 ? (
              <section className="flex flex-col gap-1">
                <h3 className="text-xs font-medium text-muted-foreground">Sub-issues</h3>
                {detail.subtasks.map((subtask) => (
                  <button
                    key={subtask.key}
                    type="button"
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => onOpenIssue(subtask.key)}
                  >
                    {subtask.status ? <JiraStatusGlyph status={subtask.status} /> : null}
                    <span className="font-mono text-xs text-muted-foreground">{subtask.key}</span>
                    <span className="truncate">{subtask.summary}</span>
                  </button>
                ))}
              </section>
            ) : null}

            <section className="flex flex-col gap-3 border-t border-border/60 pt-5">
              <h3 className="text-xs font-medium text-muted-foreground">
                Activity
                {detail.commentCount > detail.comments.length
                  ? ` · latest ${detail.comments.length} of ${detail.commentCount} comments`
                  : ""}
              </h3>
              {detail.comments.map((comment) => (
                <article key={comment.id} className="flex gap-3">
                  <JiraAvatar user={comment.author} className="mt-0.5 size-6" />
                  <div className="min-w-0 flex-1 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
                    <div className="mb-1 flex items-center gap-2 text-xs">
                      <span className="font-medium">
                        {comment.author?.displayName ?? "Unknown user"}
                      </span>
                      <span className="text-muted-foreground">
                        {comment.createdAt ? formatRelativeTimeLabel(comment.createdAt) : ""}
                      </span>
                    </div>
                    <ChatMarkdown text={comment.body} cwd={undefined} className="text-sm" />
                  </div>
                </article>
              ))}
              <CommentComposer
                key={`${siteId}/${issueKey}`}
                saving={pending === "comment"}
                onSubmit={(body) => change({ _tag: "comment", body })}
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

function PropertyTrigger({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <>
      {children}
      {busy ? (
        <Spinner aria-hidden className="size-3" />
      ) : (
        <ChevronDownIcon aria-hidden className="size-3 text-muted-foreground/70" />
      )}
    </>
  );
}

const PROPERTY_TRIGGER_CLASS = "w-fit justify-start";

function StatusMenu({
  detail,
  busy,
  onTransition,
}: {
  detail: JiraIssueDetailData;
  busy: boolean;
  onTransition: (transitionId: string) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        disabled={busy || detail.transitions.length === 0}
        render={<Button size="xs" variant="ghost" className={PROPERTY_TRIGGER_CLASS} />}
      >
        <PropertyTrigger busy={busy}>
          <JiraStatusGlyph status={detail.status} />
          {detail.status.name}
        </PropertyTrigger>
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        {detail.transitions.map((transition) => (
          <MenuItem key={transition.id} onClick={() => onTransition(transition.id)}>
            <JiraStatusGlyph status={transition.to} />
            {transition.name === transition.to.name
              ? transition.name
              : `${transition.name} → ${transition.to.name}`}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function PriorityMenu({
  detail,
  busy,
  onPriority,
}: {
  detail: JiraIssueDetailData;
  busy: boolean;
  onPriority: (priorityId: string) => void;
}) {
  const priorities =
    detail.priorities.length > 0 ? detail.priorities : detail.priority ? [detail.priority] : [];
  return (
    <Menu>
      <MenuTrigger
        disabled={busy || priorities.length === 0}
        render={<Button size="xs" variant="ghost" className={PROPERTY_TRIGGER_CLASS} />}
      >
        <PropertyTrigger busy={busy}>
          <JiraPriorityGlyph name={detail.priority?.name} />
          {detail.priority?.name ?? "No priority"}
        </PropertyTrigger>
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        <MenuRadioGroup
          value={detail.priority?.id ?? ""}
          onValueChange={(value) => {
            if (typeof value === "string" && value !== detail.priority?.id) onPriority(value);
          }}
        >
          {priorities.map((priority) => (
            <MenuRadioItem key={priority.id} value={priority.id}>
              <span className="flex items-center gap-2">
                <JiraPriorityGlyph name={priority.name} />
                {priority.name}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

const UNASSIGNED = "unassigned";

function AssigneePicker({
  environmentId,
  detail,
  account,
  busy,
  onAssign,
}: {
  environmentId: EnvironmentId;
  detail: JiraIssueDetailData;
  account: JiraUser | null;
  busy: boolean;
  onAssign: (accountId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 250);
  const users = useEnvironmentQuery(
    open
      ? jiraEnvironment.users({
          environmentId,
          input: { siteId: detail.siteId, key: detail.key, query: debounced },
        })
      : null,
  );
  const candidates = useMemo(() => {
    const list: JiraUser[] = [];
    const seen = new Set<string>();
    const add = (user: JiraUser | null) => {
      if (user === null || seen.has(user.accountId)) return;
      seen.add(user.accountId);
      list.push(user);
    };
    if (debounced.length === 0) add(account);
    for (const user of users.data?.users ?? []) add(user);
    return list;
  }, [account, debounced.length, users.data]);
  const keys = [UNASSIGNED, ...candidates.map((user) => user.accountId)];

  return (
    <Combobox
      items={keys}
      filteredItems={keys}
      filter={null}
      autoHighlight
      value={null}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
      onValueChange={(key) => {
        if (typeof key !== "string") return;
        const accountId = key === UNASSIGNED ? null : key;
        if (accountId !== (detail.assignee?.accountId ?? null)) onAssign(accountId);
      }}
    >
      <ComboboxTrigger
        disabled={busy}
        render={<Button size="xs" variant="ghost" className={PROPERTY_TRIGGER_CLASS} />}
      >
        <PropertyTrigger busy={busy}>
          <JiraAvatar user={detail.assignee} className="size-4" />
          {detail.assignee?.displayName ?? "Unassigned"}
        </PropertyTrigger>
      </ComboboxTrigger>
      <ComboboxPopup align="start" side="bottom" className="w-72">
        <ComboboxSearchInput
          aria-label="Search people"
          placeholder="Assign to…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <ComboboxList className="max-h-72">
          <ComboboxItem hideIndicator index={0} value={UNASSIGNED}>
            <span className="flex items-center gap-2">
              <UserIcon aria-hidden className="size-4 text-muted-foreground" />
              Unassigned
            </span>
          </ComboboxItem>
          {candidates.map((user, index) => (
            <ComboboxItem
              key={user.accountId}
              hideIndicator
              index={index + 1}
              value={user.accountId}
            >
              <span className="flex min-w-0 items-center gap-2">
                <JiraAvatar user={user} className="size-4" />
                <span className="truncate">{user.displayName}</span>
                {user.accountId === account?.accountId ? (
                  <span className="text-xs text-muted-foreground">(you)</span>
                ) : null}
              </span>
            </ComboboxItem>
          ))}
          {users.isPending && candidates.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</p>
          ) : null}
          {users.error ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{users.error}</p>
          ) : null}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

function EditableSummary({
  summary,
  saving,
  onSave,
}: {
  summary: string;
  saving: boolean;
  onSave: (summary: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button
        type="button"
        className="-mx-2 rounded-md px-2 py-1 text-left text-xl font-semibold tracking-tight hover:bg-accent/50"
        onClick={() => setDraft(summary)}
      >
        {summary}
      </button>
    );
  }
  const commit = async () => {
    const next = draft.trim();
    if (next.length === 0 || next === summary) {
      setDraft(null);
      return;
    }
    if (await onSave(next)) setDraft(null);
  };
  return (
    <input
      autoFocus
      value={draft}
      disabled={saving}
      aria-label="Issue title"
      className="-mx-2 rounded-md bg-accent/40 px-2 py-1 text-xl font-semibold tracking-tight outline-none ring-1 ring-ring/40"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

function CommentComposer({
  saving,
  onSubmit,
}: {
  saving: boolean;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  const submit = async () => {
    const text = body.trim();
    if (text.length === 0 || saving) return;
    if (await onSubmit(text)) setBody("");
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={body}
        rows={3}
        placeholder="Leave a comment… Markdown works."
        aria-label="Comment"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">⌘↵</span>
        <Button
          size="xs"
          disabled={saving || body.trim().length === 0}
          onClick={() => void submit()}
        >
          {saving ? <Spinner aria-hidden className="size-3" /> : null}
          Comment
        </Button>
      </div>
    </div>
  );
}

function StartThreadButton({ detail }: { detail: JiraIssueDetailData }) {
  const projects = useProjects();
  const newThread = useNewThreadHandler();
  const [choices, setChoices] = useLocalStorage(
    THREAD_PROJECT_STORAGE_KEY,
    EMPTY_CHOICES,
    ThreadProjectChoices,
  );
  const [starting, setStarting] = useState(false);
  const remembered = choices[detail.project.key] ?? null;
  const ordered = useMemo(
    () =>
      projects.toSorted((left, right) => {
        const leftKey = `${left.environmentId}:${left.id}`;
        const rightKey = `${right.environmentId}:${right.id}`;
        if (leftKey === remembered) return -1;
        if (rightKey === remembered) return 1;
        return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      }),
    [projects, remembered],
  );

  const start = async (project: (typeof projects)[number]) => {
    setStarting(true);
    try {
      const key = `${project.environmentId}:${project.id}`;
      setChoices((current) => ({ ...current, [detail.project.key]: key }));
      const session = await newThread(scopeProjectRef(project.environmentId, project.id)).catch(
        () => null,
      );
      if (session === null) {
        toastManager.add({ type: "error", title: "Could not start a thread" });
        return;
      }
      useComposerDraftStore.getState().setPrompt(session.draftId, jiraIssueThreadPrompt(detail));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Menu>
      <MenuTrigger
        disabled={starting || ordered.length === 0}
        render={<Button size="xs" variant="outline" />}
      >
        {starting ? <Spinner aria-hidden className="size-3" /> : <MessageSquarePlusIcon />}
        Start thread
        <ChevronDownIcon aria-hidden className="size-3 text-muted-foreground/70" />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" className="max-h-80">
        <MenuGroupLabel>Work on {detail.key} in</MenuGroupLabel>
        {ordered.map((project, index) => (
          <MenuItem
            key={`${project.environmentId}:${project.id}`}
            onClick={() => void start(project)}
          >
            <span className={cn("truncate", index === 0 && remembered !== null && "font-medium")}>
              {project.title}
            </span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="mt-4 h-24 w-full" />
    </div>
  );
}
