import {
  DailyBrief,
  type DailyBriefArtwork,
  type DailyBriefArtworkImage,
  DailyBriefError,
  type DailyBriefSettings,
  type DailyBriefStatus,
  defaultInstanceIdForDriver,
  type JiraIssueSummary,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type PullRequestListEntry,
  type ServerSettings,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as JiraService from "../jira/JiraService.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";

const BRIEF_MODEL = "claude-sonnet-5-5";
const BRIEF_TIMEOUT_MS = 10 * 60_000;
const SCHEDULE_TICK = Duration.minutes(5);
const RETRY_AFTER_FAILURE_MS = 30 * 60_000;
const KEEP_BRIEFS = 30;
const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");

export const BRIEF_CONNECTOR_TOOLS = [
  "mcp__claude_ai_Slack__slack_search_public_and_private",
  "mcp__claude_ai_Slack__slack_search_public",
  "mcp__claude_ai_Slack__slack_search_channels",
  "mcp__claude_ai_Slack__slack_search_users",
  "mcp__claude_ai_Slack__slack_read_channel",
  "mcp__claude_ai_Slack__slack_read_thread",
  "mcp__claude_ai_Slack__slack_read_user_profile",
  "mcp__claude_ai_Gmail__search_threads",
  "mcp__claude_ai_Gmail__get_thread",
  "mcp__claude_ai_Gmail__get_message",
  "mcp__claude_ai_Gmail__list_labels",
  "mcp__claude_ai_Google_Calendar__list_gcal_events",
  "mcp__claude_ai_Google_Calendar__fetch_gcal_event",
  "mcp__claude_ai_Google_Calendar__list_gcal_calendars",
  "mcp__claude_ai_Atlassian__getJiraIssue",
  "mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql",
  "mcp__claude_ai_Atlassian__atlassianUserInfo",
  "mcp__claude_ai_Atlassian__getAccessibleAtlassianResources",
] as const;

const ARTWORK_THEMES = [
  "landscape",
  "garden",
  "harvest",
  "river",
  "sea",
  "flowers",
  "morning",
  "village",
  "meadow",
  "orchard",
] as const;

const ArtworkSearch = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      title: Schema.optional(Schema.NullOr(Schema.String)),
      artist_title: Schema.optional(Schema.NullOr(Schema.String)),
      date_display: Schema.optional(Schema.NullOr(Schema.String)),
      medium_display: Schema.optional(Schema.NullOr(Schema.String)),
      image_id: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});

const DailyBriefJson = Schema.fromJsonString(DailyBrief);
const decodeStoredBrief = Schema.decodeUnknownEffect(DailyBriefJson);
const encodeStoredBrief = Schema.encodeEffect(DailyBriefJson);

export class DailyBriefService extends Context.Service<
  DailyBriefService,
  {
    readonly status: Effect.Effect<DailyBriefStatus, DailyBriefError>;
    readonly generate: Effect.Effect<void, DailyBriefError>;
    readonly artwork: (date: string) => Effect.Effect<DailyBriefArtworkImage, DailyBriefError>;
  }
>()("t3/brief/DailyBriefService") {}

export interface LocalDay {
  readonly date: string;
  readonly minutes: number;
  readonly label: string;
  readonly timeZone: string;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (value: number) => String(value).padStart(2, "0");

export function localDay(now: DateTime.Utc): LocalDay {
  const zone = DateTime.zoneMakeLocal();
  const parts = DateTime.toParts(DateTime.setZone(now, zone));
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    minutes: parts.hour * 60 + parts.minute,
    label: `${WEEKDAYS[parts.weekDay]} ${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`,
    timeZone: zone.id,
  };
}

export function scheduledMinutes(time: string): number {
  const [hours = "7", minutes = "30"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function isBriefDue(input: {
  readonly settings: DailyBriefSettings;
  readonly day: LocalDay;
  readonly hasBrief: boolean;
  readonly generating: boolean;
  readonly lastFailureAt: number | null;
  readonly nowMs: number;
}): boolean {
  if (!input.settings.enabled || input.hasBrief || input.generating) return false;
  if (input.day.minutes < scheduledMinutes(input.settings.time)) return false;
  return (
    input.lastFailureAt === null || input.nowMs - input.lastFailureAt >= RETRY_AFTER_FAILURE_MS
  );
}

export function briefModelSelection(settings: ServerSettings): ModelSelection {
  const configured = Object.entries(settings.providerInstances).find(
    ([, instance]) => instance.driver === CLAUDE_DRIVER && instance.enabled !== false,
  );
  const instanceId = configured
    ? ProviderInstanceId.make(configured[0])
    : defaultInstanceIdForDriver(CLAUDE_DRIVER);
  return createModelSelection(instanceId, BRIEF_MODEL, [{ id: "effort", value: "medium" }]);
}

export function describeJiraIssues(issues: ReadonlyArray<JiraIssueSummary>): string {
  return issues
    .map((issue) =>
      [
        `- ${issue.key} [${issue.status.name}]`,
        issue.priority ? `(${issue.priority.name})` : null,
        issue.summary,
        issue.parent ? `· epic: ${issue.parent.summary || issue.parent.key}` : null,
        issue.sprint ? `· sprint: ${issue.sprint}` : null,
        issue.dueDate ? `· due ${issue.dueDate}` : null,
        `· updated ${issue.updatedAt.slice(0, 10)}`,
        `· ${issue.url}`,
      ]
        .filter((part): part is string => part !== null)
        .join(" "),
    )
    .join("\n");
}

export function describePullRequests(
  entries: ReadonlyArray<PullRequestListEntry>,
  viewers: Readonly<Record<string, string>>,
): string {
  return entries
    .map((entry) => {
      const viewer = viewers[entry.host];
      const role =
        entry.author?.login === viewer
          ? "yours"
          : entry.viewerReviewRequested
            ? "review requested from you"
            : "team";
      return `- ${entry.repository}#${entry.number} [${entry.state}${entry.isDraft ? ", draft" : ""}] ${entry.title} · ${role} · by ${entry.author?.login ?? "unknown"} · updated ${entry.updatedAt.slice(0, 10)} · ${entry.url}`;
    })
    .join("\n");
}

function hashDate(date: string): number {
  let hash = 0;
  for (const char of date) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;
  const serverSettings = yield* ServerSettingsService.ServerSettingsService;
  const textGeneration = yield* TextGeneration;
  const jira = yield* JiraService.JiraService;
  const pullRequests = yield* PullRequestService.PullRequestService;

  const directory = path.join(config.stateDir, "briefs");
  const state = yield* Ref.make<{
    readonly generating: boolean;
    readonly error: string | null;
    readonly lastFailureAt: number | null;
  }>({ generating: false, error: null, lastFailureAt: null });

  const today = DateTime.now.pipe(Effect.map(localDay));

  const readBrief = (date: string) =>
    fileSystem
      .readFileString(path.join(directory, `${date}.json`))
      .pipe(Effect.flatMap(decodeStoredBrief), Effect.option);

  const writeBrief = (brief: DailyBrief) =>
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(directory, { recursive: true });
      const json = yield* encodeStoredBrief(brief);
      yield* fileSystem.writeFileString(path.join(directory, `${brief.date}.json`), json);
      const stored = (yield* fileSystem.readDirectory(directory))
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(name))
        .toSorted();
      for (const stale of stored.slice(0, Math.max(0, stored.length - KEEP_BRIEFS))) {
        yield* fileSystem.remove(path.join(directory, stale)).pipe(Effect.ignore);
        yield* fileSystem
          .remove(path.join(directory, stale.replace(/\.json$/u, ".jpg")))
          .pipe(Effect.ignore);
      }
    });

  const previousBriefDate = (date: string) =>
    fileSystem.readDirectory(directory).pipe(
      Effect.map(
        (names) =>
          names
            .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(name) && name < `${date}.json`)
            .toSorted()
            .at(-1)
            ?.slice(0, 10) ?? null,
      ),
      Effect.orElseSucceed(() => null),
    );

  const artwork = (date: string): Effect.Effect<DailyBriefArtwork | null> =>
    Effect.gen(function* () {
      const seed = hashDate(date);
      const theme = ARTWORK_THEMES[seed % ARTWORK_THEMES.length]!;
      const request = yield* HttpClientRequest.post(
        "https://api.artic.edu/api/v1/artworks/search",
      ).pipe(
        HttpClientRequest.setHeader("AIC-User-Agent", "naowee-code (daily brief)"),
        HttpClientRequest.bodyJson({
          q: theme,
          query: {
            bool: {
              must: [
                { term: { is_public_domain: true } },
                { term: { "artwork_type_title.keyword": "Painting" } },
                { exists: { field: "image_id" } },
              ],
            },
          },
          fields: ["id", "title", "artist_title", "date_display", "medium_display", "image_id"],
          limit: 40,
        }),
      );
      const response = yield* httpClient.execute(request);
      const found = yield* HttpClientResponse.schemaBodyJson(ArtworkSearch)(response);
      const candidates = found.data.filter((item) => item.image_id);
      const pick = candidates[Math.floor(seed / ARTWORK_THEMES.length) % candidates.length];
      if (!pick?.image_id) return null;
      return {
        title: pick.title ?? "Untitled",
        artist: pick.artist_title ?? "Unknown artist",
        date: pick.date_display ?? "",
        ...(pick.medium_display ? { medium: pick.medium_display } : {}),
        imageUrl: `https://www.artic.edu/iiif/2/${pick.image_id}/full/1280,/0/default.jpg`,
        url: `https://www.artic.edu/artworks/${pick.id}`,
      };
    }).pipe(
      Effect.timeout("15 seconds"),
      Effect.orElseSucceed(() => null),
    );

  const imagePath = (date: string) => path.join(directory, `${date}.jpg`);

  const downloadArtwork = (date: string, art: DailyBriefArtwork) =>
    httpClient
      .execute(
        HttpClientRequest.get(art.imageUrl).pipe(
          HttpClientRequest.setHeader("Referer", "https://www.artic.edu/"),
          HttpClientRequest.setHeader("AIC-User-Agent", "naowee-code (daily brief)"),
        ),
      )
      .pipe(
        Effect.filterOrFail((response) => response.status === 200),
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.flatMap((bytes) => fileSystem.writeFile(imagePath(date), new Uint8Array(bytes))),
        Effect.timeout("30 seconds"),
        Effect.ignore,
      );

  const jiraContext = jira.listIssues({ scope: "assigned", includeDone: true }).pipe(
    Effect.map((result) => describeJiraIssues(result.issues.slice(0, 40))),
    Effect.orElseSucceed(() => ""),
  );

  const pullRequestContext = Effect.all(
    [
      pullRequests.list({ state: "open", limit: 10 }),
      pullRequests.list({ state: "merged", limit: 5 }),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(([open, merged]) =>
      describePullRequests([...open.entries.slice(0, 25), ...merged.entries.slice(0, 10)], {
        ...merged.viewers,
        ...open.viewers,
      }),
    ),
    Effect.timeout("45 seconds"),
    Effect.orElseSucceed(() => ""),
  );

  const userIdentity = jira.sites.pipe(
    Effect.map((result) => result.sites.find((site) => site.account !== null)?.account ?? null),
    Effect.orElseSucceed(() => null),
  );

  const run = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings;
    const day = yield* today;
    const since = (yield* previousBriefDate(day.date)) ?? "yesterday";
    const [jiraText, pullRequestText, account, art] = yield* Effect.all(
      [jiraContext, pullRequestContext, userIdentity, artwork(day.date)],
      { concurrency: "unbounded" },
    );
    const generateDailyBrief = textGeneration.generateDailyBrief;
    if (!generateDailyBrief) {
      return yield* new DailyBriefError({ detail: "This build cannot write the daily brief." });
    }
    const content = yield* generateDailyBrief({
      cwd: directory,
      today: day.label,
      since,
      timeZone: day.timeZone,
      language: settings.dailyBrief.language,
      userName: account?.displayName ?? null,
      userEmail:
        Object.values(settings.jiraSites).find((site) => site.email.length > 0)?.email ?? null,
      instructions: settings.dailyBrief.instructions,
      jira: jiraText,
      pullRequests: pullRequestText,
      connectorTools: BRIEF_CONNECTOR_TOOLS,
      timeoutMs: BRIEF_TIMEOUT_MS,
      modelSelection: briefModelSelection(settings),
    });
    const generatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* writeBrief({ date: day.date, generatedAt, content, artwork: art });
    if (art !== null) yield* downloadArtwork(day.date, art);
  });

  const generateNow = Effect.gen(function* () {
    const started = yield* Ref.modify(state, (current) =>
      current.generating ? [false, current] : [true, { ...current, generating: true, error: null }],
    );
    if (!started) return;
    yield* fileSystem.makeDirectory(directory, { recursive: true }).pipe(Effect.ignore);
    const exit = yield* Effect.exit(run);
    const failedAt = yield* Clock.currentTimeMillis;
    yield* Ref.set(
      state,
      exit._tag === "Success"
        ? { generating: false, error: null, lastFailureAt: null }
        : {
            generating: false,
            error: briefFailureMessage(exit.cause),
            lastFailureAt: failedAt,
          },
    );
    if (exit._tag === "Failure") {
      yield* Effect.logWarning("daily brief generation failed", { cause: exit.cause });
    }
  });

  const tick = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings;
    const day = yield* today;
    const current = yield* Ref.get(state);
    const hasBrief = Option.isSome(yield* readBrief(day.date));
    if (
      isBriefDue({
        settings: settings.dailyBrief,
        day,
        hasBrief,
        generating: current.generating,
        lastFailureAt: current.lastFailureAt,
        nowMs: yield* Clock.currentTimeMillis,
      })
    ) {
      yield* generateNow;
    }
  }).pipe(Effect.catchCause((cause) => Effect.logWarning("daily brief tick failed", { cause })));

  yield* tick.pipe(
    Effect.delay(Duration.seconds(20)),
    Effect.andThen(Effect.repeat(tick, Schedule.spaced(SCHEDULE_TICK))),
    Effect.forkScoped,
  );

  return DailyBriefService.of({
    status: Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const day = yield* today;
      const current = yield* Ref.get(state);
      const brief = yield* readBrief(day.date);
      const latest = Option.isSome(brief)
        ? brief
        : yield* previousBriefDate(day.date).pipe(
            Effect.flatMap((date) => (date === null ? Effect.succeedNone : readBrief(date))),
          );
      return {
        today: day.date,
        brief: Option.getOrNull(latest),
        generating: current.generating,
        error: current.error,
        enabled: settings.dailyBrief.enabled,
        time: settings.dailyBrief.time,
      } satisfies DailyBriefStatus;
    }).pipe(
      Effect.mapError(
        (cause) => new DailyBriefError({ detail: "Could not read the daily brief.", cause }),
      ),
    ),
    generate: generateNow.pipe(Effect.forkDetach, Effect.asVoid),
    artwork: (date) =>
      Effect.gen(function* () {
        if (!(yield* fileSystem.exists(imagePath(date)))) {
          const brief = yield* readBrief(date);
          if (Option.isNone(brief) || brief.value.artwork === null) return { dataUrl: null };
          yield* downloadArtwork(date, brief.value.artwork);
        }
        const bytes = yield* fileSystem.readFile(imagePath(date)).pipe(Effect.option);
        return {
          dataUrl: Option.isSome(bytes)
            ? `data:image/jpeg;base64,${Buffer.from(bytes.value).toString("base64")}`
            : null,
        };
      }).pipe(
        Effect.mapError(
          (cause) => new DailyBriefError({ detail: "Could not read the painting.", cause }),
        ),
      ),
  });
});

function briefFailureMessage(cause: Cause.Cause<unknown>): string {
  const text = Cause.pretty(cause);
  if (/not logged in|login|authenticate/iu.test(text)) {
    return "Claude is not signed in on this machine. Sign in to Claude Code and try again.";
  }
  if (/timed out/iu.test(text)) return "Writing the brief took too long. Try again.";
  return "The brief could not be written. Try again in a moment.";
}

export const layer = Layer.effect(DailyBriefService, make);
