import type {
  DailyBriefEvent,
  DailyBriefFocus,
  DailyBriefItem,
  DailyBriefLanguage,
  DailyBriefSource,
} from "@t3tools/contracts";

const WEEKDAYS: Record<DailyBriefLanguage, ReadonlyArray<string>> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

function parseDate(date: string): { year: number; month: number; day: number; weekday: number } {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday };
}

export function briefTitle(
  date: string,
  language: DailyBriefLanguage,
): { eyebrow: string; title: string } {
  const weekday = WEEKDAYS[language][parseDate(date).weekday] ?? "";
  return language === "es"
    ? { eyebrow: "El brief del", title: weekday }
    : { eyebrow: "The", title: `${weekday} Brief` };
}

export function verticalDate(date: string, language: DailyBriefLanguage): string {
  const { year, month, day } = parseDate(date);
  return `${day} ${(language === "es" ? MESES : MONTHS)[month - 1]} ${year}`;
}

export const BRIEF_LABELS: Record<
  DailyBriefLanguage,
  {
    focus: string;
    todos: string;
    updates: string;
    day: string;
    doIt: string;
    prep: string;
    draft: string;
    noEvents: string;
    madeFor: string;
    using: string;
    your: string;
    and: string;
    unavailable: string;
  }
> = {
  en: {
    focus: "Push your work forward",
    todos: "Top to-dos",
    updates: "New updates",
    day: "Your day",
    doIt: "Let's do it",
    prep: "Prep me",
    draft: "First step",
    noEvents: "No meetings today. The runway is yours.",
    madeFor: "Made for you by",
    using: "using",
    your: "your",
    and: "and",
    unavailable: "Not reachable this time",
  },
  es: {
    focus: "Empuja tu trabajo",
    todos: "Pendientes clave",
    updates: "Novedades",
    day: "Tu día",
    doIt: "Hagámoslo",
    prep: "Prepárame",
    draft: "Primer paso",
    noEvents: "Sin reuniones hoy. El día es tuyo.",
    madeFor: "Hecho para ti por",
    using: "con",
    your: "tu",
    and: "y",
    unavailable: "Esta vez no se pudo consultar",
  },
};

function sourceLines(sources: ReadonlyArray<DailyBriefSource>): string {
  return sources
    .map((source) => `- ${source.label}${source.url ? ` (${source.url})` : ""}`)
    .join("\n");
}

export function focusThreadPrompt(focus: DailyBriefFocus): string {
  return [
    `From today's brief: ${focus.title}`,
    focus.detail,
    focus.draft.trim().length > 0 ? `Starting point:\n${focus.draft}` : "",
    focus.sources.length > 0 ? `Sources:\n${sourceLines(focus.sources)}` : "",
    "Help me move this forward. Start from the starting point and ask me only what you cannot find in the sources.",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export function todoThreadPrompt(todo: DailyBriefItem): string {
  return [
    `From today's brief: ${todo.title}`,
    todo.detail,
    todo.sources.length > 0 ? `Sources:\n${sourceLines(todo.sources)}` : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n")
    .concat("\n\n");
}

export function eventPrepPrompt(event: DailyBriefEvent, date: string): string {
  return [
    `Prep me for "${event.title}" today (${date}) at ${event.start}${event.end ? `–${event.end}` : ""}.`,
    event.detail,
    event.url ? `Invitation: ${event.url}` : "",
    "Read the related Jira issues, Slack threads and mail, then give me the context, open questions and three talking points.",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}
