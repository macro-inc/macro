import { For, Match, Show, Switch } from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from '../../settings/primitives';
import { RecordingKindRow } from '../components/recording-kind-row';
import { useCallSettings } from '../context/call-settings-context';
import {
  isBlockedByTeam,
  RECORDING_KINDS,
  recordsByDefault,
} from '../core/recording-kinds';

export function CallSettingsView() {
  const calls = useCallSettings();
  const source = calls.createSource();

  return (
    <SettingsPage
      title="Calls"
      description="Choose which calls start recording on their own."
    >
      <Switch
        fallback={
          <p role="status" class="text-sm text-ink-muted">
            Loading call settings…
          </p>
        }
      >
        <Match when={source.settings()}>
          {(settings) => (
            <>
              <SettingsSection
                title="Record by default"
                description="Calls you start begin recording automatically. Clear every option to keep recording off."
              >
                <SettingsCard>
                  <For each={RECORDING_KINDS}>
                    {(option) => (
                      <RecordingKindRow
                        label={option.label}
                        description={option.description}
                        checked={recordsByDefault(settings(), option.kind)}
                        disabled={isBlockedByTeam(settings(), option.kind)}
                        disabledReason="Your team admins have blocked recording these calls."
                        onChange={(value) =>
                          calls.setRecordByDefault(option.kind, value)
                        }
                      />
                    )}
                  </For>
                </SettingsCard>
              </SettingsSection>

              <Show when={settings().team}>
                {(team) => (
                  <SettingsSection
                    title="Team recording policy"
                    description="Block recording for everyone on your team. Blocked calls never record, whatever each person's default."
                    actions={
                      <Show when={!team().canEdit}>
                        <span class="text-xs text-ink-muted">Admins only</span>
                      </Show>
                    }
                  >
                    <SettingsCard>
                      <For each={RECORDING_KINDS}>
                        {(option) => (
                          <RecordingKindRow
                            label={`Block ${option.label.toLowerCase()}`}
                            description={option.description}
                            checked={team().blocked[option.kind]}
                            disabled={!team().canEdit}
                            disabledReason="Only team admins can change this."
                            onChange={(blocked) =>
                              calls.setTeamBlock(option.kind, blocked)
                            }
                          />
                        )}
                      </For>
                    </SettingsCard>
                  </SettingsSection>
                )}
              </Show>
            </>
          )}
        </Match>
        <Match when={source.error()}>
          <p role="alert" class="text-sm text-failure">
            Call settings couldn't load. Try again later.
          </p>
        </Match>
      </Switch>
    </SettingsPage>
  );
}
