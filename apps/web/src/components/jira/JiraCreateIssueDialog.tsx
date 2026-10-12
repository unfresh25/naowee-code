import type {
  EnvironmentId,
  JiraCreateIssueResult,
  JiraSiteId,
  JiraSiteStatus,
} from "@t3tools/contracts";
import { useState } from "react";

import { jiraEnvironment } from "~/state/jira";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { JiraIssueTypeGlyph, JiraPriorityGlyph } from "./jiraPresentation";

export function JiraCreateIssueDialog({
  environmentId,
  sites,
  defaultSiteId,
  defaultProjectKey,
  onOpenChange,
  onCreated,
}: {
  environmentId: EnvironmentId;
  sites: ReadonlyArray<JiraSiteStatus>;
  defaultSiteId: JiraSiteId | null;
  defaultProjectKey: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: JiraCreateIssueResult) => void;
}) {
  const usableSites = sites.filter((site) => site.error === null);
  const [siteId, setSiteId] = useState<JiraSiteId | null>(
    usableSites.find((site) => site.siteId === defaultSiteId)?.siteId ??
      usableSites[0]?.siteId ??
      null,
  );
  const options = useEnvironmentQuery(
    siteId === null ? null : jiraEnvironment.createOptions({ environmentId, input: { siteId } }),
  );
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [issueTypeId, setIssueTypeId] = useState<string | null>(null);
  const [priorityId, setPriorityId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [assignToMe, setAssignToMe] = useState(true);
  const [saving, setSaving] = useState(false);
  const createIssue = useAtomCommand(jiraEnvironment.createIssue, { label: "create Jira issue" });

  const projects = options.data?.projects ?? [];
  const project =
    projects.find((candidate) => candidate.key === projectKey) ??
    projects.find((candidate) => candidate.key === defaultProjectKey) ??
    projects[0] ??
    null;
  const issueType =
    project?.issueTypes.find((type) => type.id === issueTypeId) ??
    project?.issueTypes.find((type) => /task|tarea/iu.test(type.name)) ??
    project?.issueTypes[0] ??
    null;
  const priorities = options.data?.priorities ?? [];
  const priority = priorities.find((candidate) => candidate.id === priorityId) ?? null;
  const canSave =
    siteId !== null &&
    project !== null &&
    issueType !== null &&
    summary.trim().length > 0 &&
    !saving;

  const save = async () => {
    if (!canSave || siteId === null || project === null || issueType === null) return;
    setSaving(true);
    try {
      const result = await createIssue({
        environmentId,
        input: {
          siteId,
          projectKey: project.key,
          issueTypeId: issueType.id,
          summary: summary.trim(),
          ...(description.trim().length > 0 ? { description: description.trim() } : {}),
          ...(priority === null ? {} : { priorityId: priority.id }),
          assignToMe,
        },
      });
      if (result._tag === "Success") onCreated(result.value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New issue</DialogTitle>
          <DialogDescription>Creates the issue in Jira and opens it here.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex flex-wrap gap-2">
              {usableSites.length > 1 ? (
                <Select
                  value={siteId ?? ""}
                  onValueChange={(value) => {
                    if (typeof value !== "string") return;
                    setSiteId(value as JiraSiteId);
                    setProjectKey(null);
                    setIssueTypeId(null);
                    setPriorityId(null);
                  }}
                >
                  <SelectTrigger size="sm" className="w-auto" aria-label="Jira site">
                    <SelectValue>
                      {usableSites.find((site) => site.siteId === siteId)?.label ?? "Site"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {usableSites.map((site) => (
                      <SelectItem hideIndicator key={site.siteId} value={site.siteId}>
                        {site.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : null}
              <Select
                value={project?.key ?? ""}
                onValueChange={(value) => {
                  if (typeof value !== "string") return;
                  setProjectKey(value);
                  setIssueTypeId(null);
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-auto"
                  aria-label="Project"
                  disabled={projects.length === 0}
                >
                  <SelectValue>
                    {project
                      ? `${project.name} (${project.key})`
                      : options.isPending
                        ? "Loading…"
                        : "Project"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false} className="max-h-72">
                  {projects.map((candidate) => (
                    <SelectItem hideIndicator key={candidate.key} value={candidate.key}>
                      {candidate.name}{" "}
                      <span className="text-muted-foreground">{candidate.key}</span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Select
                value={issueType?.id ?? ""}
                onValueChange={(value) => {
                  if (typeof value === "string") setIssueTypeId(value);
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-auto"
                  aria-label="Issue type"
                  disabled={issueType === null}
                >
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      <JiraIssueTypeGlyph type={issueType} />
                      {issueType?.name ?? "Type"}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {(project?.issueTypes ?? []).map((type) => (
                    <SelectItem hideIndicator key={type.id} value={type.id}>
                      <span className="flex items-center gap-2">
                        <JiraIssueTypeGlyph type={type} />
                        {type.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {priorities.length > 0 ? (
                <Select
                  value={priority?.id ?? ""}
                  onValueChange={(value) => {
                    if (typeof value === "string") setPriorityId(value.length > 0 ? value : null);
                  }}
                >
                  <SelectTrigger size="sm" className="w-auto" aria-label="Priority">
                    <SelectValue>
                      <span className="flex items-center gap-2">
                        <JiraPriorityGlyph name={priority?.name} />
                        {priority?.name ?? "Default priority"}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    <SelectItem hideIndicator value="">
                      <span className="flex items-center gap-2">
                        <JiraPriorityGlyph name={null} />
                        Default priority
                      </span>
                    </SelectItem>
                    {priorities.map((candidate) => (
                      <SelectItem hideIndicator key={candidate.id} value={candidate.id}>
                        <span className="flex items-center gap-2">
                          <JiraPriorityGlyph name={candidate.name} />
                          {candidate.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : null}
            </div>
            {options.error ? <p className="text-sm text-destructive">{options.error}</p> : null}
            <div className="grid gap-1.5">
              <Label htmlFor="jira-new-summary">Title</Label>
              <Input
                id="jira-new-summary"
                autoFocus
                value={summary}
                placeholder="Issue title"
                onChange={(event) => setSummary(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="jira-new-description">Description</Label>
              <Textarea
                id="jira-new-description"
                rows={6}
                value={description}
                placeholder="Add a description… Markdown works."
                onChange={(event) => setDescription(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void save();
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="jira-new-assign"
                checked={assignToMe}
                onCheckedChange={(checked) => setAssignToMe(checked === true)}
              />
              <Label htmlFor="jira-new-assign">Assign to me</Label>
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={() => void save()}>
            {saving ? <Spinner aria-hidden className="size-3" /> : null}
            Create issue
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
