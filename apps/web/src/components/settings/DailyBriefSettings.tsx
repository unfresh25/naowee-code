import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { dailyBriefEnvironment } from "../../state/brief";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
] as const;

export function DailyBriefSettings() {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? null : <DailyBriefSection environmentId={environmentId} />;
}

function DailyBriefSection({ environmentId }: { environmentId: EnvironmentId }) {
  const brief = useEnvironmentSettings(environmentId, (settings) => settings.dailyBrief);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const generate = useAtomCommand(dailyBriefEnvironment.generate, {
    label: "write the daily brief",
  });
  const [instructions, setInstructions] = useState(brief.instructions);

  return (
    <SettingsSection
      {...searchableSetting("daily-brief")}
      headerAction={
        <Button
          size="xs"
          variant="outline"
          onClick={() => void generate({ environmentId, input: {} })}
        >
          Write now
        </Button>
      }
    >
      <SettingsRow
        title="Write a brief every morning"
        description="Claude reads your Jira issues, Slack, Gmail and pull requests with your claude.ai connectors and writes the Today page. It only reads; it never sends or changes anything."
        control={
          <Switch
            aria-label="Write a daily brief"
            checked={brief.enabled}
            disabled={!canWrite}
            onCheckedChange={(enabled) => updateSettings({ dailyBrief: { enabled } })}
          />
        }
      />
      <SettingsRow
        title="Time"
        description="If Naowee Code is closed then, the brief is written when it next opens that day."
        control={
          <Input
            type="time"
            size="sm"
            aria-label="Brief time"
            className="w-28"
            disabled={!canWrite}
            value={brief.time}
            onChange={(event) => {
              const time = event.target.value;
              if (/^\d{2}:\d{2}$/u.test(time)) updateSettings({ dailyBrief: { time } });
            }}
          />
        }
      />
      <SettingsRow
        title="Language"
        control={
          <Select
            value={brief.language}
            onValueChange={(value) => {
              if (value === "es" || value === "en")
                updateSettings({ dailyBrief: { language: value } });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-36"
              aria-label="Brief language"
              disabled={!canWrite}
            >
              <SelectValue>
                {LANGUAGES.find((language) => language.value === brief.language)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {LANGUAGES.map((language) => (
                <SelectItem hideIndicator key={language.value} value={language.value}>
                  {language.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="What to watch"
        description="Channels, people, projects or priorities the brief should pay attention to."
      >
        <Textarea
          rows={3}
          disabled={!canWrite}
          value={instructions}
          placeholder="For example: #data-team and #devops matter most. Ciclo Olímpico is the priority this month."
          onChange={(event) => setInstructions(event.target.value)}
          onBlur={() => {
            if (instructions.trim() !== brief.instructions) {
              updateSettings({ dailyBrief: { instructions: instructions.trim() } });
            }
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
