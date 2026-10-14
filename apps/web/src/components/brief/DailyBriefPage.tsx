import type {
  DailyBrief,
  DailyBriefEvent,
  DailyBriefItem,
  DailyBriefLanguage,
  DailyBriefSource,
  DailyBriefSourceKind,
  EnvironmentId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ArrowRightIcon, CalendarIcon, LinkIcon, SettingsIcon } from "lucide-react";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { isElectron } from "~/env";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { dailyBriefEnvironment } from "~/state/brief";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { StartThreadMenu } from "../StartThreadMenu";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "../ui/empty";
import { RefreshIcon } from "../ui/refresh-icon";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  BRIEF_LABELS,
  briefTitle,
  eventPrepPrompt,
  focusThreadPrompt,
  todoThreadPrompt,
  verticalDate,
} from "./dailyBrief.logic";
import { GitHubIcon, GmailLogo, JiraBrandLogo, SlackLogo } from "../Icons";

const DoneTodos = Schema.Record(Schema.String, Schema.Array(Schema.Number));
const EMPTY_DONE: Readonly<Record<string, ReadonlyArray<number>>> = {};

export function DailyBriefPage() {
  const environmentId = usePrimaryEnvironmentId();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      {environmentId === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Connect to a Naowee Code server to see your brief.
        </div>
      ) : (
        <DailyBriefWorkspace environmentId={environmentId} />
      )}
    </SidebarInset>
  );
}

function DailyBriefWorkspace({ environmentId }: { environmentId: EnvironmentId }) {
  const navigate = useNavigate();
  const language = useEnvironmentSettings(
    environmentId,
    (settings) => settings.dailyBrief.language,
  );
  const query = useEnvironmentQuery(dailyBriefEnvironment.status({ environmentId, input: {} }));
  const generate = useAtomCommand(dailyBriefEnvironment.generate, {
    label: "write the daily brief",
  });
  const status = query.data;
  const generating = status?.generating ?? false;
  const refreshStatus = query.refresh;

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(refreshStatus, 4_000);
    return () => window.clearInterval(timer);
  }, [generating, refreshStatus]);

  const write = () => {
    void generate({ environmentId, input: {} }).then(() => refreshStatus());
  };
  const brief = status?.brief ?? null;
  const stale = brief !== null && status !== null && brief.date !== status.today;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      <WorkspacePageHeader electron={isElectron}>
        <WorkspaceBreadcrumb ariaLabel="Brief breadcrumb" className="min-w-0">
          <WorkspaceBreadcrumbItem current>
            <h1>Today</h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        <div className="min-w-0 flex-1" />
        {status?.error ? (
          <span className="truncate text-xs text-destructive">{status.error}</span>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Write the brief again"
                disabled={generating}
                onClick={write}
              />
            }
          >
            <RefreshIcon size="sm" refreshing={generating} />
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {generating ? "Writing your brief…" : "Write the brief again"}
          </TooltipPopup>
        </Tooltip>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Brief settings"
          onClick={() => void navigate({ to: "/settings/integrations" })}
        >
          <SettingsIcon />
        </Button>
      </WorkspacePageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {status === null ? (
          query.error ? (
            <p className="p-6 text-sm text-muted-foreground">{query.error}</p>
          ) : (
            <BriefSkeleton />
          )
        ) : brief === null || (stale && generating) ? (
          <Empty className="h-full">
            <EmptyHeader>
              <h2 className="font-serif text-2xl italic">
                {generating ? "Writing today's brief…" : "No brief yet"}
              </h2>
              <EmptyDescription>
                {generating
                  ? "Reading your Jira issues, Slack, Gmail and pull requests. This takes a minute or two."
                  : status.enabled
                    ? `It is written every day at ${status.time} while Naowee Code is open. You can also write it now.`
                    : "The daily brief is off. Turn it on in Settings → Integrations, or write one now."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {generating ? (
                <Spinner aria-hidden />
              ) : (
                <Button size="sm" onClick={write}>
                  Write today's brief
                </Button>
              )}
            </EmptyContent>
          </Empty>
        ) : (
          <BriefView
            environmentId={environmentId}
            brief={brief}
            language={language}
            stale={stale}
          />
        )}
      </div>
    </div>
  );
}

function BriefView({
  environmentId,
  brief,
  language,
  stale,
}: {
  environmentId: EnvironmentId;
  brief: DailyBrief;
  language: DailyBriefLanguage;
  stale: boolean;
}) {
  const labels = BRIEF_LABELS[language];
  const title = briefTitle(brief.date, language);
  const content = brief.content;
  const generatedAt = new Date(brief.generatedAt);
  const time = Number.isNaN(generatedAt.getTime())
    ? ""
    : generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [done, setDone] = useLocalStorage("naowee:brief:done-v1", EMPTY_DONE, DoneTodos);
  const doneToday = new Set(done[brief.date] ?? []);
  const toggleTodo = (index: number) =>
    setDone((current) => {
      const today = new Set(current[brief.date] ?? []);
      if (today.has(index)) today.delete(index);
      else today.add(index);
      return { [brief.date]: [...today] };
    });
  const [selectedEvent, setSelectedEvent] = useState(0);
  const event = content.events[selectedEvent] ?? content.events[0] ?? null;

  return (
    <article className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-6 pt-10 pb-20 xl:px-28">
      <header className="flex flex-col gap-3">
        <div className="relative">
          <span
            aria-hidden
            className="absolute top-1/2 -left-20 hidden -translate-y-1/2 rotate-180 font-serif text-4xl tracking-tight whitespace-nowrap italic [writing-mode:vertical-rl] xl:block"
          >
            {verticalDate(brief.date, language)}
          </span>
          <span
            aria-hidden
            className="absolute top-1/2 -right-20 hidden -translate-y-1/2 font-serif text-4xl tracking-tight whitespace-nowrap italic [writing-mode:vertical-rl] xl:block"
          >
            {time}
          </span>
          <div className="relative aspect-2/1 overflow-hidden rounded-sm bg-muted">
            {brief.artwork ? (
              <BriefArtworkImage
                environmentId={environmentId}
                date={brief.date}
                alt={brief.artwork.title}
              />
            ) : null}
            <div className="absolute inset-0 bg-linear-to-b from-black/10 via-transparent to-black/30" />
            <h2 className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center font-serif leading-none text-brief-accent drop-shadow-lg">
              <span className="text-4xl italic sm:text-6xl">{title.eyebrow}</span>
              <span className="text-5xl font-semibold tracking-tight capitalize sm:text-8xl">
                {title.title}
              </span>
            </h2>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-10">
          <p className="font-serif text-base text-foreground/75 italic">
            {content.tagline}
            {stale ? ` · ${verticalDate(brief.date, language)}` : ""}
          </p>
          {brief.artwork ? (
            <a
              href={brief.artwork.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 font-mono text-3xs leading-relaxed text-muted-foreground/60 hover:text-muted-foreground sm:max-w-80 sm:text-right"
            >
              {brief.artwork.title}, {brief.artwork.artist}
              {brief.artwork.date ? `, ${brief.artwork.date}` : ""}
              {brief.artwork.medium ? `. ${brief.artwork.medium}` : ""}
            </a>
          ) : null}
        </div>
      </header>

      {content.focus ? (
        <section className="grid gap-6 rounded-xl bg-card p-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex flex-col justify-between gap-6">
            <SectionLabel>{labels.focus}</SectionLabel>
            <StartThreadMenu
              heading={labels.focus}
              rememberKey="brief"
              align="start"
              buildPrompt={() => focusThreadPrompt(content.focus!)}
              render={<StarburstButton />}
            >
              {(starting) =>
                starting ? <Spinner aria-hidden /> : <StarLabel>{labels.doIt}</StarLabel>
              }
            </StartThreadMenu>
          </div>
          <div className="flex flex-col gap-2">
            <ItemTitle sources={content.focus.sources}>{content.focus.title}</ItemTitle>
            <ItemDetail>{content.focus.detail}</ItemDetail>
            {content.focus.draft.trim().length > 0 ? (
              <div className="mt-2 flex flex-col gap-1 border-l-2 border-brief-accent/60 pl-3">
                <span className="font-serif text-xs text-muted-foreground italic">
                  {labels.draft}
                </span>
                <p className="text-sm whitespace-pre-line text-muted-foreground">
                  {content.focus.draft}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {content.todos.length > 0 ? (
        <BriefSection label={labels.todos}>
          {content.todos.map((todo, index) => (
            <TodoRow
              key={todo.title}
              todo={todo}
              done={doneToday.has(index)}
              onToggle={() => toggleTodo(index)}
              startLabel={labels.doIt}
            />
          ))}
        </BriefSection>
      ) : null}

      {content.updates.length > 0 ? (
        <BriefSection label={labels.updates}>
          {content.updates.map((update, index) => (
            <div key={update.title} className="flex gap-4">
              <span className="w-6 shrink-0 pt-0.5 font-mono text-2xs text-muted-foreground/70 tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <ItemTitle sources={update.sources}>
                  {update.title}
                  {update.topic ? (
                    <span className="ml-2 font-serif text-xs font-normal text-muted-foreground italic">
                      {update.topic}
                    </span>
                  ) : null}
                </ItemTitle>
                <ItemDetail>{update.detail}</ItemDetail>
              </div>
            </div>
          ))}
        </BriefSection>
      ) : null}

      <section className="grid gap-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-4">
          <SectionLabel>{labels.day}</SectionLabel>
          {content.events.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {content.events.map((candidate, index) => (
                <li key={candidate.title}>
                  <button
                    type="button"
                    onClick={() => setSelectedEvent(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm",
                      event === candidate ? "bg-card" : "hover:bg-card/60",
                    )}
                  >
                    <span className="w-11 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                      {candidate.start}
                    </span>
                    <span className="truncate">{candidate.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {event ? (
          <EventDetail event={event} date={brief.date} prepLabel={labels.prep} />
        ) : (
          <p className="self-end font-serif text-sm text-muted-foreground italic">
            {labels.noEvents}
          </p>
        )}
      </section>

      <footer className="flex flex-col items-center gap-2 pt-6 text-center">
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 font-serif text-lg text-muted-foreground">
          {labels.madeFor} <span className="text-foreground">Naowee Code</span> {labels.using}{" "}
          <span className="italic">{labels.your}</span>
          <BrandName logo={<JiraBrandLogo className="size-4" />} name="Jira" />,
          <BrandName logo={<SlackLogo className="size-4" />} name="Slack" />,
          <BrandName logo={<GmailLogo className="h-3.5 w-4.5" />} name="Gmail" /> {labels.and}
          <BrandName logo={<GitHubIcon className="size-4" />} name="GitHub" />.
        </p>
        {content.unavailableSources.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {labels.unavailable}: {content.unavailableSources.join(", ")}.
          </p>
        ) : null}
      </footer>
    </article>
  );
}

function BriefSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="grid gap-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <SectionLabel>{label}</SectionLabel>
      <div className="flex flex-col gap-7">{children}</div>
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="font-serif text-xl tracking-tight italic">{children}</h3>;
}

function ItemTitle({
  sources,
  children,
}: {
  sources: ReadonlyArray<DailyBriefSource>;
  children: ReactNode;
}) {
  return (
    <h4 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium">
      <span>{children}</span>
      {sources.map((source) => (
        <SourceBadge key={source.label} source={source} />
      ))}
    </h4>
  );
}

function ItemDetail({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

const SOURCE_ICONS: Record<DailyBriefSourceKind, (props: { className?: string }) => ReactNode> = {
  jira: (props) => <JiraBrandLogo {...props} />,
  slack: (props) => <SlackLogo {...props} />,
  gmail: (props) => <GmailLogo {...props} />,
  calendar: (props) => <CalendarIcon {...props} />,
  github: (props) => <GitHubIcon {...props} />,
  other: (props) => <LinkIcon {...props} />,
};

function SourceBadge({ source }: { source: DailyBriefSource }) {
  const icon = SOURCE_ICONS[source.kind]({ className: "size-3.5" });
  const className =
    "inline-flex items-center text-muted-foreground opacity-45 grayscale transition-[filter,opacity] duration-150 hover:text-foreground hover:opacity-100 hover:grayscale-0";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              aria-label={source.label}
              className={className}
            />
          ) : (
            <span className={className} />
          )
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipPopup side="top">{source.label}</TooltipPopup>
    </Tooltip>
  );
}

function BrandName({ logo, name }: { logo: ReactNode; name: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-foreground">
      {logo}
      {name}
    </span>
  );
}

function BriefArtworkImage({
  environmentId,
  date,
  alt,
}: {
  environmentId: EnvironmentId;
  date: string;
  alt: string;
}) {
  const image = useEnvironmentQuery(
    dailyBriefEnvironment.artwork({ environmentId, input: { date } }),
  ).data;
  if (!image?.dataUrl) return null;
  return <img src={image.dataUrl} alt={alt} className="absolute inset-0 size-full object-cover" />;
}

function TodoRow({
  todo,
  done,
  onToggle,
  startLabel,
}: {
  todo: DailyBriefItem;
  done: boolean;
  onToggle: () => void;
  startLabel: string;
}) {
  return (
    <div className="group/todo flex gap-3">
      <button
        type="button"
        aria-pressed={done}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        onClick={onToggle}
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          done ? "border-brief-accent bg-brief-accent" : "border-muted-foreground/50",
        )}
      >
        {done ? <span className="size-1.5 rounded-full bg-brief-accent-foreground" /> : null}
      </button>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", done && "opacity-50")}>
        <ItemTitle sources={todo.sources}>
          <span className={cn(done && "line-through")}>{todo.title}</span>
        </ItemTitle>
        <ItemDetail>{todo.detail}</ItemDetail>
        <span className="w-fit opacity-0 group-hover/todo:opacity-100 focus-within:opacity-100">
          <StartThreadMenu
            heading={todo.title}
            rememberKey="brief"
            align="start"
            buildPrompt={() => todoThreadPrompt(todo)}
            render={<Button size="micro" variant="ghost-muted" />}
          >
            {(starting) => (
              <>
                {starting ? <Spinner aria-hidden className="size-3" /> : <ArrowRightIcon />}
                {startLabel}
              </>
            )}
          </StartThreadMenu>
        </span>
      </div>
    </div>
  );
}

function EventDetail({
  event,
  date,
  prepLabel,
}: {
  event: DailyBriefEvent;
  date: string;
  prepLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium">
        {event.title} — {event.start}
        {event.end ? ` – ${event.end}` : ""}
      </h4>
      <ItemDetail>{event.detail}</ItemDetail>
      <div className="flex justify-end pt-2">
        <StartThreadMenu
          heading={event.title}
          rememberKey="brief"
          buildPrompt={() => eventPrepPrompt(event, date)}
          render={<StarburstButton />}
        >
          {(starting) => (starting ? <Spinner aria-hidden /> : <StarLabel>{prepLabel}</StarLabel>)}
        </StartThreadMenu>
      </div>
    </div>
  );
}

const STARBURST_POINTS = Array.from({ length: 28 }, (_, index) => {
  const angle = (Math.PI * index) / 14;
  const radius = index % 2 === 0 ? 50 : 43;
  return `${50 + radius * Math.cos(angle)},${50 + radius * Math.sin(angle)}`;
}).join(" ");

function StarburstButton(props: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className="relative flex size-24 shrink-0 -rotate-12 items-center justify-center text-brief-accent-foreground transition-transform duration-150 hover:rotate-0 focus-visible:outline-2 focus-visible:outline-brief-accent disabled:opacity-60"
    >
      <svg
        viewBox="0 0 100 100"
        aria-hidden
        className="absolute inset-0 size-full text-brief-accent"
      >
        <polygon points={STARBURST_POINTS} fill="currentColor" />
      </svg>
      <span className="relative">{props.children}</span>
    </button>
  );
}

function StarLabel({ children }: { children: ReactNode }) {
  return (
    <span className="flex max-w-18 flex-col items-center gap-0.5 text-center font-serif text-xs leading-tight font-semibold italic">
      {children}
      <ArrowRightIcon aria-hidden className="size-3" />
    </span>
  );
}

function BriefSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-10">
      <Skeleton className="aspect-video w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton shape="card" className="h-32 w-full" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}
