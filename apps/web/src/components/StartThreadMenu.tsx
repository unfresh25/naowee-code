import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";

import { Menu, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { toastManager } from "./ui/toast";

const ThreadProjectChoices = Schema.Record(Schema.String, Schema.String);
const EMPTY_CHOICES: Readonly<Record<string, string>> = {};

export function StartThreadMenu({
  heading,
  rememberKey,
  buildPrompt,
  render,
  align = "end",
  children,
}: {
  heading: string;
  rememberKey: string;
  buildPrompt: () => string;
  render: ReactElement;
  align?: "start" | "center" | "end";
  children: (starting: boolean) => ReactNode;
}) {
  const projects = useProjects();
  const newThread = useNewThreadHandler();
  const [choices, setChoices] = useLocalStorage(
    "naowee:thread-projects-v1",
    EMPTY_CHOICES,
    ThreadProjectChoices,
  );
  const [starting, setStarting] = useState(false);
  const remembered = choices[rememberKey] ?? null;
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
      setChoices((current) => ({
        ...current,
        [rememberKey]: `${project.environmentId}:${project.id}`,
      }));
      const session = await newThread(scopeProjectRef(project.environmentId, project.id)).catch(
        () => null,
      );
      if (session === null) {
        toastManager.add({ type: "error", title: "Could not start a thread" });
        return;
      }
      useComposerDraftStore.getState().setPrompt(session.draftId, buildPrompt());
    } finally {
      setStarting(false);
    }
  };

  return (
    <Menu>
      <MenuTrigger disabled={starting || ordered.length === 0} render={render}>
        {children(starting)}
      </MenuTrigger>
      <MenuPopup align={align} side="bottom" className="max-h-80">
        <MenuGroupLabel>{heading}</MenuGroupLabel>
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
