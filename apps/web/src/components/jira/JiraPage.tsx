import {
  JiraIssueScope,
  type EnvironmentId,
  type JiraIssueSummary,
  type JiraListIssuesInput,
  JiraSiteId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  GlobeIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { isElectron } from "~/env";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { isEditableFocused } from "~/lib/editableFocus";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { jiraEnvironment } from "~/state/jira";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { JiraCreateIssueDialog } from "./JiraCreateIssueDialog";
import { JiraIssueBoard } from "./JiraIssueBoard";
import { JiraIssueDetail } from "./JiraIssueDetail";
import { JiraIssueList } from "./JiraIssueList";
import { JiraBoardIcon } from "./jiraPresentation";
import {
  buildBoardColumns,
  groupIssuesByStatus,
  jiraIssueId,
  type JiraBoardColumnView,
  matchesIssueQuery,
  parseJiraIssueId,
  pickBoard,
} from "./jiraIssues.logic";

const JiraViewPreferences = Schema.Struct({
  scope: JiraIssueScope,
  includeDone: Schema.Boolean,
  siteId: Schema.NullOr(Schema.String),
  projectKey: Schema.NullOr(Schema.String),
  view: Schema.optionalKey(Schema.Literals(["list", "board"])),
});
type JiraViewPreferences = typeof JiraViewPreferences.Type;

const DEFAULT_PREFERENCES: JiraViewPreferences = {
  scope: "assigned",
  includeDone: false,
  siteId: null,
  projectKey: null,
};

const SCOPE_OPTIONS: ReadonlyArray<{ value: JiraIssueScope; label: string }> = [
  { value: "assigned", label: "Assigned" },
  { value: "reported", label: "Created" },
  { value: "all", label: "All" },
];

const ISSUE_KEY = /^[a-z][a-z0-9_]*-\d+$/iu;
const isJiraIssueScope = Schema.is(JiraIssueScope);
const ALL = "";
const EMPTY_PLACEMENTS: ReadonlyMap<string, string> = new Map();
const BoardChoices = Schema.Record(Schema.String, Schema.String);
const EMPTY_BOARD_CHOICES: Readonly<Record<string, string>> = {};

export function JiraPage({
  selectedIssue,
  onSelectIssue,
}: {
  selectedIssue: string | undefined;
  onSelectIssue: (issue: string | undefined) => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      {environmentId === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Connect to a Naowee Code server to see Jira issues.
        </div>
      ) : (
        <JiraWorkspace
          environmentId={environmentId}
          selectedIssue={selectedIssue}
          onSelectIssue={onSelectIssue}
        />
      )}
    </SidebarInset>
  );
}

function JiraWorkspace({
  environmentId,
  selectedIssue,
  onSelectIssue,
}: {
  environmentId: EnvironmentId;
  selectedIssue: string | undefined;
  onSelectIssue: (issue: string | undefined) => void;
}) {
  const navigate = useNavigate();
  const configuredSites = useEnvironmentSettings(environmentId, (settings) => settings.jiraSites);
  const hasSites = Object.values(configuredSites).some((site) => site.enabled);
  const [preferences, setPreferences] = useLocalStorage(
    "naowee:jira:view-v1",
    DEFAULT_PREFERENCES,
    JiraViewPreferences,
  );
  const updatePreferences = useCallback(
    (patch: Partial<JiraViewPreferences>) =>
      setPreferences((current) => ({ ...current, ...patch })),
    [setPreferences],
  );
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 400);
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const sitesQuery = useEnvironmentQuery(
    hasSites ? jiraEnvironment.sites({ environmentId, input: {} }) : null,
  );
  const sites = sitesQuery.data?.sites ?? [];
  const siteFilter =
    preferences.siteId !== null &&
    configuredSites[JiraSiteId.make(preferences.siteId)]?.enabled === true
      ? JiraSiteId.make(preferences.siteId)
      : null;

  const view = preferences.view ?? "list";
  const includeDone = view === "board" || preferences.includeDone;
  const listInput = useMemo<JiraListIssuesInput>(
    () => ({
      scope: preferences.scope,
      includeDone,
      ...(siteFilter === null ? {} : { siteIds: [siteFilter] }),
      ...(debouncedSearch.length >= 2 ? { query: debouncedSearch } : {}),
    }),
    [debouncedSearch, includeDone, preferences.scope, siteFilter],
  );
  const issuesQuery = useEnvironmentQuery(
    hasSites ? jiraEnvironment.issues({ environmentId, input: listInput }) : null,
  );
  const allIssues = issuesQuery.data?.issues;

  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    for (const issue of allIssues ?? []) projects.set(issue.project.key, issue.project.name);
    if (preferences.projectKey !== null && !projects.has(preferences.projectKey)) {
      projects.set(preferences.projectKey, preferences.projectKey);
    }
    return [...projects.entries()].toSorted((left, right) => left[1].localeCompare(right[1]));
  }, [allIssues, preferences.projectKey]);

  const trimmedSearch = search.trim();
  const clientFilter = trimmedSearch !== debouncedSearch || ISSUE_KEY.test(trimmedSearch);
  const visibleIssues = useMemo(
    () =>
      (allIssues ?? []).filter(
        (issue) =>
          (preferences.projectKey === null || issue.project.key === preferences.projectKey) &&
          (!clientFilter || matchesIssueQuery(issue, trimmedSearch)),
      ),
    [allIssues, clientFilter, preferences.projectKey, trimmedSearch],
  );
  const groups = useMemo(() => groupIssuesByStatus(visibleIssues), [visibleIssues]);
  const boardProject = useMemo(() => {
    if (view !== "board") return null;
    if (preferences.projectKey !== null) {
      const match = visibleIssues.find((issue) => issue.project.key === preferences.projectKey);
      const siteId =
        match?.siteId ?? siteFilter ?? (sites.length === 1 ? (sites[0]?.siteId ?? null) : null);
      return siteId === null ? null : { siteId, projectKey: preferences.projectKey };
    }
    const first = visibleIssues[0];
    if (
      first === undefined ||
      visibleIssues.some(
        (issue) => issue.siteId !== first.siteId || issue.project.key !== first.project.key,
      )
    ) {
      return null;
    }
    return { siteId: first.siteId, projectKey: first.project.key };
  }, [preferences.projectKey, siteFilter, sites, view, visibleIssues]);
  const boardsQuery = useEnvironmentQuery(
    boardProject === null ? null : jiraEnvironment.boards({ environmentId, input: boardProject }),
  );
  const [boardChoices, setBoardChoices] = useLocalStorage(
    "naowee:jira:boards-v1",
    EMPTY_BOARD_CHOICES,
    BoardChoices,
  );
  const boardChoiceKey =
    boardProject === null ? null : `${boardProject.siteId}/${boardProject.projectKey}`;
  const projectBoards = boardsQuery.data?.boards ?? [];
  const board = useMemo(
    () =>
      pickBoard(
        boardsQuery.data?.boards ?? [],
        visibleIssues,
        boardChoiceKey === null ? null : (boardChoices[boardChoiceKey] ?? null),
      ),
    [boardChoiceKey, boardChoices, boardsQuery.data, visibleIssues],
  );
  const [placementState, setPlacementState] = useState<{
    readonly issues: typeof allIssues;
    readonly placements: ReadonlyMap<string, string>;
  }>({ issues: undefined, placements: new Map() });
  const placements =
    placementState.issues === allIssues ? placementState.placements : EMPTY_PLACEMENTS;
  const columns = useMemo(
    () => buildBoardColumns(visibleIssues, board, placements),
    [board, placements, visibleIssues],
  );
  const navigationOrder = useMemo(
    () =>
      view === "board"
        ? columns.flatMap((column) => column.issues)
        : groups.flatMap((group) => (collapsed.has(group.id) ? [] : group.issues)),
    [collapsed, columns, groups, view],
  );
  const refreshIssues = issuesQuery.refresh;
  const moveCommand = useAtomCommand(jiraEnvironment.updateIssue, { label: "move Jira issue" });
  const moveIssue = useCallback(
    async (issue: JiraIssueSummary, column: JiraBoardColumnView) => {
      const id = jiraIssueId(issue);
      setPlacementState((current) => {
        const next = new Map(current.issues === allIssues ? current.placements : []);
        next.set(id, column.id);
        return { issues: allIssues, placements: next };
      });
      const result = await moveCommand({
        environmentId,
        input: {
          siteId: issue.siteId,
          key: issue.key,
          change: { _tag: "move", statusIds: [...column.statusIds] },
        },
      });
      if (result._tag === "Success") {
        refreshIssues();
        return;
      }
      setPlacementState((current) => {
        const next = new Map(current.placements);
        next.delete(id);
        return { ...current, placements: next };
      });
    },
    [allIssues, environmentId, moveCommand, refreshIssues],
  );

  const selected = parseJiraIssueId(selectedIssue);
  const selectedSite = selected ? sites.find((site) => site.siteId === selected.siteId) : undefined;
  const siteLabels = useMemo(
    () => new Map(sites.map((site) => [site.siteId as string, site.label])),
    [sites],
  );
  const failingSites = (issuesQuery.data?.sites ?? []).filter((site) => site.error !== null);

  const selectIssue = useCallback(
    (issue: Pick<JiraIssueSummary, "siteId" | "key">) => onSelectIssue(jiraIssueId(issue)),
    [onSelectIssue],
  );

  useEffect(() => {
    if (selectedIssue === undefined) return;
    scrollRef.current
      ?.querySelector(`[data-jira-issue="${CSS.escape(selectedIssue)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIssue]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableFocused(event.target) || creating) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[role=menu],[role=dialog],[role=listbox]")
      ) {
        return;
      }
      if (event.key === "Escape" && selectedIssue !== undefined) {
        event.preventDefault();
        onSelectIssue(undefined);
        return;
      }
      if (event.key === "c") {
        event.preventDefault();
        setCreating(true);
        return;
      }
      const arrowsApply =
        event.target === document.body ||
        (event.target instanceof Element && event.target.closest("[data-jira-issue]") !== null);
      const step =
        event.key === "j" || (arrowsApply && event.key === "ArrowDown")
          ? 1
          : event.key === "k" || (arrowsApply && event.key === "ArrowUp")
            ? -1
            : 0;
      if (step === 0 || navigationOrder.length === 0) return;
      event.preventDefault();
      const index = navigationOrder.findIndex((issue) => jiraIssueId(issue) === selectedIssue);
      const next =
        index === -1
          ? navigationOrder[step > 0 ? 0 : navigationOrder.length - 1]
          : navigationOrder[Math.min(navigationOrder.length - 1, Math.max(0, index + step))];
      if (next) selectIssue(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [creating, navigationOrder, onSelectIssue, selectIssue, selectedIssue]);

  const openSettings = () => void navigate({ to: "/settings/integrations" });
  const refresh = () => {
    issuesQuery.refresh();
    sitesQuery.refresh();
  };
  const refreshing = issuesQuery.isPending && issuesQuery.data !== null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} reserveNativeControls={selected === null}>
          <WorkspaceBreadcrumb ariaLabel="Jira breadcrumb" className="min-w-0">
            <WorkspaceBreadcrumbItem current>
              <h1>Issues</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          {hasSites ? (
            <>
              <ToggleGroup
                aria-label="Layout"
                variant="segmented"
                value={[view]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "list" || value === "board") updatePreferences({ view: value });
                }}
              >
                <Toggle value="list" aria-label="List" title="List">
                  <ListIcon />
                </Toggle>
                <Toggle value="board" aria-label="Board" title="Board">
                  <JiraBoardIcon />
                </Toggle>
              </ToggleGroup>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh issues"
                aria-busy={refreshing}
                disabled={refreshing}
                onClick={refresh}
              >
                <RefreshIcon size="sm" refreshing={refreshing} />
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={sites.every((site) => site.error !== null)}
                onClick={() => setCreating(true)}
              >
                <PlusIcon />
                New issue
              </Button>
            </>
          ) : null}
        </WorkspacePageHeader>

        {hasSites ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
              <ToggleGroup
                aria-label="Whose issues"
                variant="segmented"
                value={[preferences.scope]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (isJiraIssueScope(value)) updatePreferences({ scope: value });
                }}
              >
                {SCOPE_OPTIONS.map((option) => (
                  <Toggle key={option.value} value={option.value}>
                    {option.label}
                  </Toggle>
                ))}
              </ToggleGroup>
              {sites.length > 1 ? (
                <FilterMenu
                  label="Site"
                  icon={<GlobeIcon aria-hidden className="size-3.5" />}
                  value={siteFilter ?? ALL}
                  allLabel="All sites"
                  options={sites.map((site) => ({ value: site.siteId, label: site.label }))}
                  onChange={(value) => updatePreferences({ siteId: value === ALL ? null : value })}
                />
              ) : null}
              {projectOptions.length > 1 || preferences.projectKey !== null ? (
                <FilterMenu
                  label="Project"
                  icon={<FolderIcon aria-hidden className="size-3.5" />}
                  value={preferences.projectKey ?? ALL}
                  allLabel="All projects"
                  options={projectOptions.map(([key, name]) => ({
                    value: key,
                    label: `${name} · ${key}`,
                  }))}
                  onChange={(value) =>
                    updatePreferences({ projectKey: value === ALL ? null : value })
                  }
                />
              ) : null}
              {view === "list" ? (
                <Button
                  size="xs"
                  variant="ghost-muted"
                  aria-pressed={preferences.includeDone}
                  onClick={() => updatePreferences({ includeDone: !preferences.includeDone })}
                >
                  {preferences.includeDone ? <CheckIcon /> : null}
                  Show done
                </Button>
              ) : null}
              {view === "board" && board !== null && boardChoiceKey !== null ? (
                <FilterMenu
                  label="Board"
                  icon={<JiraBoardIcon className="size-3.5" />}
                  value={board.id}
                  options={projectBoards.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.name,
                  }))}
                  onChange={(value) =>
                    setBoardChoices((current) => ({ ...current, [boardChoiceKey]: value }))
                  }
                />
              ) : null}
              <InputGroup className="ms-auto w-full max-w-64 **:[input]:h-8 sm:**:[input]:h-7">
                <InputGroupAddon>
                  <SearchIcon aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  value={search}
                  placeholder="Search issues"
                  aria-label="Search issues"
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
              </InputGroup>
            </div>
            {failingSites.map((site) => (
              <div
                key={site.siteId}
                className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/8 px-4 py-1.5 text-xs text-warning-foreground"
              >
                <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{site.error}</span>
                <Button size="micro" variant="ghost" onClick={openSettings}>
                  Settings
                </Button>
              </div>
            ))}
          </>
        ) : null}

        <div
          ref={scrollRef}
          className={
            view === "board" && hasSites
              ? "min-h-0 flex-1 overflow-hidden"
              : "min-h-0 flex-1 overflow-y-auto"
          }
        >
          {!hasSites ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyTitle>Connect Jira</EmptyTitle>
                <EmptyDescription>
                  Add a Jira site with your email and an API token to see your issues here. You can
                  connect as many sites as you work with.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" onClick={openSettings}>
                  <SettingsIcon />
                  Open Jira settings
                </Button>
              </EmptyContent>
            </Empty>
          ) : allIssues === undefined ? (
            issuesQuery.error ? (
              <p className="p-6 text-sm text-muted-foreground">{issuesQuery.error}</p>
            ) : (
              <ListSkeleton />
            )
          ) : view === "board" && columns.length > 0 ? (
            <JiraIssueBoard
              environmentId={environmentId}
              columns={columns}
              selectedId={selectedIssue ?? null}
              onSelect={selectIssue}
              onMove={(issue, column) => void moveIssue(issue, column)}
            />
          ) : groups.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyTitle>
                  {trimmedSearch.length > 0 || preferences.projectKey !== null
                    ? "No matching issues"
                    : preferences.scope === "assigned"
                      ? "Nothing assigned to you"
                      : "No open issues"}
                </EmptyTitle>
                <EmptyDescription>
                  {includeDone
                    ? "Try another filter."
                    : "Done issues are hidden. Turn on Show done to include recent ones."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <JiraIssueList
                groups={groups}
                collapsed={collapsed}
                onToggleGroup={(id) =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                selectedId={selectedIssue ?? null}
                showSite={sites.length > 1 && siteFilter === null}
                siteLabels={siteLabels}
                onSelect={selectIssue}
              />
              {issuesQuery.data?.truncated ? (
                <p className="px-4 pb-6 text-xs text-muted-foreground">
                  Showing the 100 most recently updated issues per site. Narrow the filters or
                  search to find older ones.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      {selected !== null ? (
        <aside className="flex w-[min(44rem,50%)] min-w-[24rem] shrink-0 flex-col border-l border-border/60 bg-background">
          <JiraIssueDetail
            key={selectedIssue}
            environmentId={environmentId}
            siteId={JiraSiteId.make(selected.siteId)}
            issueKey={selected.key}
            account={selectedSite?.account ?? null}
            onChanged={issuesQuery.refresh}
            onClose={() => onSelectIssue(undefined)}
            onOpenIssue={(key) => selectIssue({ siteId: JiraSiteId.make(selected.siteId), key })}
          />
        </aside>
      ) : null}

      {creating ? (
        <JiraCreateIssueDialog
          environmentId={environmentId}
          sites={sites}
          defaultSiteId={siteFilter ?? (selected ? JiraSiteId.make(selected.siteId) : null)}
          defaultProjectKey={preferences.projectKey}
          onOpenChange={setCreating}
          onCreated={(created) => {
            setCreating(false);
            issuesQuery.refresh();
            selectIssue(created);
          }}
        />
      ) : null}
    </div>
  );
}

function FilterMenu({
  label,
  icon,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  allLabel?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <Menu>
      <MenuTrigger aria-label={label} render={<Button size="xs" variant="ghost-muted" />}>
        {icon}
        <span className="max-w-40 truncate">{current?.label ?? allLabel ?? label}</span>
        <ChevronDownIcon aria-hidden className="size-3 text-muted-foreground/70" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (typeof next === "string") onChange(next);
          }}
        >
          {allLabel === undefined ? null : (
            <>
              <MenuRadioItem value={ALL}>{allLabel}</MenuRadioItem>
              <MenuSeparator />
            </>
          )}
          {options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex h-10 items-center gap-3 border-b border-border/40 px-4">
          <Skeleton className="size-3.5" />
          <Skeleton className="h-3 w-14" />
          <Skeleton shape="pill" className="size-3.5" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton shape="pill" className="size-5" />
        </div>
      ))}
    </div>
  );
}
