import { createFileRoute } from "@tanstack/react-router";

import { DailyBriefPage } from "../components/brief/DailyBriefPage";

export const Route = createFileRoute("/_chat/brief")({
  component: DailyBriefPage,
});
