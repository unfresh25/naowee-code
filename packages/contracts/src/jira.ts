import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const JiraSiteId = Schema.String.pipe(Schema.brand("JiraSiteId"));
export type JiraSiteId = typeof JiraSiteId.Type;

export const JiraSiteConfig = Schema.Struct({
  label: Schema.optional(TrimmedNonEmptyString),
  url: TrimmedNonEmptyString,
  email: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  apiToken: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type JiraSiteConfig = typeof JiraSiteConfig.Type;

export const JiraUser = Schema.Struct({
  accountId: TrimmedNonEmptyString,
  displayName: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
});
export type JiraUser = typeof JiraUser.Type;

export const JiraStatusCategory = Schema.Literals(["todo", "in-progress", "done"]);
export type JiraStatusCategory = typeof JiraStatusCategory.Type;

export const JiraStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: JiraStatusCategory,
});
export type JiraStatus = typeof JiraStatus.Type;

export const JiraPriority = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});
export type JiraPriority = typeof JiraPriority.Type;

export const JiraIssueType = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  subtask: Schema.Boolean,
});
export type JiraIssueType = typeof JiraIssueType.Type;

export const JiraProjectRef = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
});
export type JiraProjectRef = typeof JiraProjectRef.Type;

export const JiraIssueLink = Schema.Struct({
  key: Schema.String,
  summary: Schema.String,
  status: Schema.NullOr(JiraStatus),
});
export type JiraIssueLink = typeof JiraIssueLink.Type;

export const JiraIssueSummary = Schema.Struct({
  siteId: JiraSiteId,
  key: Schema.String,
  url: Schema.String,
  summary: Schema.String,
  status: JiraStatus,
  priority: Schema.NullOr(JiraPriority),
  issueType: Schema.NullOr(JiraIssueType),
  project: JiraProjectRef,
  assignee: Schema.NullOr(JiraUser),
  labels: Schema.Array(Schema.String),
  parent: Schema.NullOr(JiraIssueLink),
  sprint: Schema.NullOr(Schema.String),
  dueDate: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type JiraIssueSummary = typeof JiraIssueSummary.Type;

export const JiraComment = Schema.Struct({
  id: Schema.String,
  author: Schema.NullOr(JiraUser),
  body: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type JiraComment = typeof JiraComment.Type;

export const JiraTransition = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  to: JiraStatus,
});
export type JiraTransition = typeof JiraTransition.Type;

export const JiraTransitionsResult = Schema.Struct({
  transitions: Schema.Array(JiraTransition),
});
export type JiraTransitionsResult = typeof JiraTransitionsResult.Type;

export const JiraIssueDetail = Schema.Struct({
  ...JiraIssueSummary.fields,
  description: Schema.String,
  reporter: Schema.NullOr(JiraUser),
  subtasks: Schema.Array(JiraIssueLink),
  comments: Schema.Array(JiraComment),
  commentCount: NonNegativeInt,
  transitions: Schema.Array(JiraTransition),
  priorities: Schema.Array(JiraPriority),
});
export type JiraIssueDetail = typeof JiraIssueDetail.Type;

export const JiraSiteStatus = Schema.Struct({
  siteId: JiraSiteId,
  label: Schema.String,
  url: Schema.String,
  account: Schema.NullOr(JiraUser),
  error: Schema.NullOr(Schema.String),
});
export type JiraSiteStatus = typeof JiraSiteStatus.Type;

export const JiraSitesResult = Schema.Struct({
  sites: Schema.Array(JiraSiteStatus),
});
export type JiraSitesResult = typeof JiraSitesResult.Type;

export const JiraIssueScope = Schema.Literals(["assigned", "reported", "all"]);
export type JiraIssueScope = typeof JiraIssueScope.Type;

const JiraProjectKey = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

export const JiraListIssuesInput = Schema.Struct({
  siteIds: Schema.optionalKey(Schema.Array(JiraSiteId).check(Schema.isMaxLength(20))),
  scope: JiraIssueScope,
  includeDone: Schema.Boolean,
  query: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(200))),
});
export type JiraListIssuesInput = typeof JiraListIssuesInput.Type;

export const JiraListIssuesResult = Schema.Struct({
  issues: Schema.Array(JiraIssueSummary),
  sites: Schema.Array(JiraSiteStatus),
  truncated: Schema.Boolean,
});
export type JiraListIssuesResult = typeof JiraListIssuesResult.Type;

export const JiraIssueRef = Schema.Struct({
  siteId: JiraSiteId,
  key: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
});
export type JiraIssueRef = typeof JiraIssueRef.Type;

const JiraText = Schema.String.check(Schema.isMaxLength(32_000));

export const JiraIssueChange = Schema.Union([
  Schema.TaggedStruct("transition", { transitionId: TrimmedNonEmptyString }),
  Schema.TaggedStruct("move", {
    statusIds: Schema.Array(TrimmedNonEmptyString).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(50),
    ),
  }),
  Schema.TaggedStruct("assignee", { accountId: Schema.NullOr(TrimmedNonEmptyString) }),
  Schema.TaggedStruct("priority", { priorityId: TrimmedNonEmptyString }),
  Schema.TaggedStruct("summary", {
    summary: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  }),
  Schema.TaggedStruct("comment", { body: TrimmedNonEmptyString.check(Schema.isMaxLength(32_000)) }),
]);
export type JiraIssueChange = typeof JiraIssueChange.Type;

export const JiraUpdateIssueInput = Schema.Struct({
  ...JiraIssueRef.fields,
  change: JiraIssueChange,
});
export type JiraUpdateIssueInput = typeof JiraUpdateIssueInput.Type;

export const JiraBoardInput = Schema.Struct({
  siteId: JiraSiteId,
  projectKey: JiraProjectKey,
});
export type JiraBoardInput = typeof JiraBoardInput.Type;

export const JiraBoardColumn = Schema.Struct({
  name: Schema.String,
  statuses: Schema.Array(JiraStatus),
});
export type JiraBoardColumn = typeof JiraBoardColumn.Type;

export const JiraBoard = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  columns: Schema.Array(JiraBoardColumn),
});
export type JiraBoard = typeof JiraBoard.Type;

export const JiraProjectBoards = Schema.Struct({
  boards: Schema.Array(JiraBoard),
});
export type JiraProjectBoards = typeof JiraProjectBoards.Type;

export const JiraSearchUsersInput = Schema.Struct({
  ...JiraIssueRef.fields,
  query: TrimmedString.check(Schema.isMaxLength(100)),
});
export type JiraSearchUsersInput = typeof JiraSearchUsersInput.Type;

export const JiraSearchUsersResult = Schema.Struct({
  users: Schema.Array(JiraUser),
});
export type JiraSearchUsersResult = typeof JiraSearchUsersResult.Type;

export const JiraCreateOptionsInput = Schema.Struct({
  siteId: JiraSiteId,
});
export type JiraCreateOptionsInput = typeof JiraCreateOptionsInput.Type;

export const JiraCreateProject = Schema.Struct({
  ...JiraProjectRef.fields,
  issueTypes: Schema.Array(JiraIssueType),
});
export type JiraCreateProject = typeof JiraCreateProject.Type;

export const JiraCreateOptions = Schema.Struct({
  projects: Schema.Array(JiraCreateProject),
  priorities: Schema.Array(JiraPriority),
});
export type JiraCreateOptions = typeof JiraCreateOptions.Type;

export const JiraCreateIssueInput = Schema.Struct({
  siteId: JiraSiteId,
  projectKey: JiraProjectKey,
  issueTypeId: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  description: Schema.optionalKey(JiraText),
  priorityId: Schema.optionalKey(TrimmedNonEmptyString),
  assignToMe: Schema.Boolean,
});
export type JiraCreateIssueInput = typeof JiraCreateIssueInput.Type;

export const JiraCreateIssueResult = Schema.Struct({
  siteId: JiraSiteId,
  key: Schema.String,
  url: Schema.String,
});
export type JiraCreateIssueResult = typeof JiraCreateIssueResult.Type;

export class JiraError extends Schema.TaggedError<JiraError>()("JiraError", {
  operation: Schema.String,
  detail: TrimmedNonEmptyString,
  siteId: Schema.optional(JiraSiteId),
  status: Schema.optional(Schema.Int),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
