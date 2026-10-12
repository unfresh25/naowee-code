import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type JiraSiteConfig,
  JiraSiteId,
  type JiraSiteStatus,
} from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { jiraEnvironment } from "../../state/jira";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
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
import { Spinner } from "../ui/spinner";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const API_TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

function siteHost(url: string): string {
  const trimmed = url.trim();
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`).host;
  } catch {
    return trimmed;
  }
}

function siteIdFromUrl(url: string): JiraSiteId {
  const slug = siteHost(url)
    .toLowerCase()
    .replace(/\.atlassian\.net$/u, "")
    .replace(/[^a-z0-9.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return JiraSiteId.make(slug || "jira");
}

export function JiraSettings() {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? null : <JiraSitesSection environmentId={environmentId} />;
}

function JiraSitesSection({ environmentId }: { environmentId: EnvironmentId }) {
  const sites = useEnvironmentSettings(environmentId, (settings) => settings.jiraSites);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const entries = Object.entries(sites);
  const status = useEnvironmentQuery(
    entries.length > 0 ? jiraEnvironment.sites({ environmentId, input: {} }) : null,
  );
  const persist = useAtomCommand(serverEnvironment.updateSettings, { label: "save Jira site" });
  const [editing, setEditing] = useState<{ id: JiraSiteId | null } | null>(null);

  const save = async (id: JiraSiteId, site: JiraSiteConfig | null) => {
    const result = await persist({
      environmentId,
      input: { patch: { jiraSites: { [id]: site } } },
    });
    if (result._tag === "Success") status.refresh();
    return result._tag === "Success";
  };

  return (
    <>
      <SettingsSection
        {...searchableSetting("jira-sites")}
        headerAction={
          canWrite ? (
            <Button size="xs" variant="outline" onClick={() => setEditing({ id: null })}>
              <PlusIcon className="size-3" aria-hidden />
              Add site
            </Button>
          ) : null
        }
      >
        {entries.length === 0 ? (
          <SettingsRow
            title="No Jira sites connected."
            description="Add a site with your email and an API token to see its issues from the Jira button in the sidebar."
          />
        ) : (
          entries.map(([id, site]) => {
            const siteStatus = status.data?.sites.find((entry) => entry.siteId === id);
            return (
              <SettingsRow
                key={id}
                title={site.label ?? siteHost(site.url)}
                description={
                  <JiraSiteDescription
                    url={site.url}
                    email={site.email}
                    enabled={site.enabled}
                    status={siteStatus}
                    checking={status.isPending && siteStatus === undefined}
                  />
                }
                control={
                  canWrite ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setEditing({ id: JiraSiteId.make(id) })}
                      >
                        Edit
                      </Button>
                      <RemoveJiraSiteButton
                        label={site.label ?? siteHost(site.url)}
                        onConfirm={() => void save(JiraSiteId.make(id), null)}
                      />
                    </div>
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>
      {editing !== null ? (
        <JiraSiteDialog
          existing={editing.id === null ? null : { id: editing.id, site: sites[editing.id]! }}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSave={async (id, site) => {
            const saved = await save(id, site);
            if (saved) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function JiraSiteDescription({
  url,
  email,
  enabled,
  status,
  checking,
}: {
  url: string;
  email: string;
  enabled: boolean;
  status: JiraSiteStatus | undefined;
  checking: boolean;
}) {
  const host = siteHost(url);
  if (!enabled) return <span>{host} · Disabled</span>;
  if (status?.error) return <span className="text-destructive">{status.error}</span>;
  if (status?.account) {
    return (
      <span>
        {host} · Connected as {status.account.displayName}
      </span>
    );
  }
  return (
    <span>
      {host} · {email || "No email"}
      {checking ? " · Checking…" : ""}
    </span>
  );
}

function JiraSiteDialog({
  existing,
  onOpenChange,
  onSave,
}: {
  existing: { id: JiraSiteId; site: JiraSiteConfig } | null;
  onOpenChange: (open: boolean) => void;
  onSave: (id: JiraSiteId, site: JiraSiteConfig) => Promise<void>;
}) {
  const [url, setUrl] = useState(existing?.site.url ?? "");
  const [email, setEmail] = useState(existing?.site.email ?? "");
  const [apiToken, setApiToken] = useState("");
  const [label, setLabel] = useState(existing?.site.label ?? "");
  const [saving, setSaving] = useState(false);
  const hasSavedToken = (existing?.site.apiToken.length ?? 0) > 0;
  const canSave =
    url.trim().length > 0 &&
    email.trim().length > 0 &&
    (apiToken.trim().length > 0 || hasSavedToken) &&
    !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(existing?.id ?? siteIdFromUrl(url), {
        ...(label.trim() ? { label: label.trim() } : {}),
        url: url.trim(),
        email: email.trim(),
        apiToken: apiToken.trim() || (existing?.site.apiToken ?? ""),
        enabled: true,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Jira site" : "Connect a Jira site"}</DialogTitle>
          <DialogDescription>
            On{" "}
            <a href={API_TOKEN_URL} target="_blank" rel="noreferrer" className="underline">
              id.atlassian.com
            </a>
            , choose <span className="font-medium">Create API token</span> (not the scoped kind).
            The token stays on this server and is only used to read and update your issues.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="jira-site-url">Site</Label>
              <Input
                id="jira-site-url"
                placeholder="your-team.atlassian.net"
                value={url}
                disabled={existing !== null}
                autoFocus={existing === null}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="jira-site-email">Atlassian email</Label>
              <Input
                id="jira-site-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="jira-site-token">API token</Label>
              <Input
                id="jira-site-token"
                type="password"
                autoComplete="off"
                placeholder={hasSavedToken ? "Saved. Paste a new one to replace it." : ""}
                autoFocus={existing !== null}
                value={apiToken}
                onChange={(event) => setApiToken(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="jira-site-label">Name (optional)</Label>
              <Input
                id="jira-site-label"
                placeholder="Defaults to the site address"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={() => void save()}>
            {saving ? <Spinner aria-hidden className="size-3" /> : null}
            {existing ? "Save" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function RemoveJiraSiteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its API token is deleted from this server and its issues leave the Jira view. Nothing
              changes in Jira.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Remove site
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
