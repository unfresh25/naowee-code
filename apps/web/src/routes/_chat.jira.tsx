import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { JiraPage } from "../components/jira/JiraPage";

export interface JiraSearch {
  readonly issue?: string;
}

export const Route = createFileRoute("/_chat/jira")({
  validateSearch: (raw: Record<string, unknown>): JiraSearch =>
    typeof raw.issue === "string" && raw.issue.length > 0 ? { issue: raw.issue } : {},
  component: JiraRouteView,
});

function JiraRouteView() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <JiraPage
      selectedIssue={search.issue}
      onSelectIssue={(issue) =>
        void navigate({ to: "/jira", search: issue === undefined ? {} : { issue }, replace: true })
      }
    />
  );
}
