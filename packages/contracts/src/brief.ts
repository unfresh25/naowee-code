import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedString } from "./baseSchemas.ts";

export const DailyBriefSourceKind = Schema.Literals([
  "jira",
  "slack",
  "gmail",
  "calendar",
  "github",
  "other",
]);
export type DailyBriefSourceKind = typeof DailyBriefSourceKind.Type;

export const DailyBriefSource = Schema.Struct({
  kind: DailyBriefSourceKind,
  label: Schema.String,
  url: Schema.NullOr(Schema.String),
});
export type DailyBriefSource = typeof DailyBriefSource.Type;

export const DailyBriefItem = Schema.Struct({
  title: Schema.String,
  detail: Schema.String,
  sources: Schema.Array(DailyBriefSource),
});
export type DailyBriefItem = typeof DailyBriefItem.Type;

export const DailyBriefFocus = Schema.Struct({
  ...DailyBriefItem.fields,
  draft: Schema.String,
});
export type DailyBriefFocus = typeof DailyBriefFocus.Type;

export const DailyBriefUpdate = Schema.Struct({
  ...DailyBriefItem.fields,
  topic: Schema.String,
});
export type DailyBriefUpdate = typeof DailyBriefUpdate.Type;

export const DailyBriefEvent = Schema.Struct({
  start: Schema.String,
  end: Schema.NullOr(Schema.String),
  title: Schema.String,
  detail: Schema.String,
  url: Schema.NullOr(Schema.String),
});
export type DailyBriefEvent = typeof DailyBriefEvent.Type;

export const DailyBriefContent = Schema.Struct({
  tagline: Schema.String,
  focus: Schema.NullOr(DailyBriefFocus),
  todos: Schema.Array(DailyBriefItem),
  updates: Schema.Array(DailyBriefUpdate),
  events: Schema.Array(DailyBriefEvent),
  unavailableSources: Schema.Array(Schema.String),
});
export type DailyBriefContent = typeof DailyBriefContent.Type;

export const DailyBriefArtwork = Schema.Struct({
  title: Schema.String,
  artist: Schema.String,
  date: Schema.String,
  medium: Schema.optionalKey(Schema.String),
  imageUrl: Schema.String,
  url: Schema.String,
});
export type DailyBriefArtwork = typeof DailyBriefArtwork.Type;

export const DailyBrief = Schema.Struct({
  date: Schema.String,
  generatedAt: Schema.String,
  content: DailyBriefContent,
  artwork: Schema.NullOr(DailyBriefArtwork),
});
export type DailyBrief = typeof DailyBrief.Type;

export const DailyBriefStatus = Schema.Struct({
  today: Schema.String,
  brief: Schema.NullOr(DailyBrief),
  generating: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  time: Schema.String,
});
export type DailyBriefStatus = typeof DailyBriefStatus.Type;

export const DailyBriefDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));

export const DailyBriefArtworkImage = Schema.Struct({
  dataUrl: Schema.NullOr(Schema.String),
});
export type DailyBriefArtworkImage = typeof DailyBriefArtworkImage.Type;

export const DailyBriefLanguage = Schema.Literals(["es", "en"]);
export type DailyBriefLanguage = typeof DailyBriefLanguage.Type;

export const DailyBriefTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/u));

export const DailyBriefSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  time: DailyBriefTime.pipe(Schema.withDecodingDefault(Effect.succeed("07:30"))),
  language: DailyBriefLanguage.pipe(Schema.withDecodingDefault(Effect.succeed("es" as const))),
  instructions: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type DailyBriefSettings = typeof DailyBriefSettings.Type;

export class DailyBriefError extends Schema.TaggedError<DailyBriefError>()("DailyBriefError", {
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
