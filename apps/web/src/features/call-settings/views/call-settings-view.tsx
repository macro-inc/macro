import { For, Match, Show, Switch } from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from '../../settings/primitives';
import { CheckboxRow } from '../components/checkbox-row';
import { SelectRow } from '../components/select-row';
import { useCallSettings } from '../context/call-settings-context';
import {
  type CallSettings,
  isHuddleSharingBlocked,
  isRecordingBlocked,
  RECORDING_KINDS,
  type RecordingKind,
  recordsByDefault,
  SHARE_AUDIENCE_LABELS,
  type ShareAudience,
  shareAudience,
} from '../core/call-settings';

const ADMINS_ONLY = 'Only team admins can change this.';

/** Why a sharing default doesn't fully apply under the team's huddle block. */
function huddleBlockNote(
  settings: CallSettings,
  kind: RecordingKind
): string | undefined {
  if (!isHuddleSharingBlocked(settings)) return undefined;
  if (kind === 'oneOnOnes' && settings.shareByDefault.oneOnOnes === 'team') {
    return 'Your team admins have blocked sharing huddles with the team, so DM huddles stay between the two of you.';
  }
  return undefined;
}

export function CallSettingsView() {
  const calls = useCallSettings();
  const source = calls.createSource();

  return (
    <SettingsPage
      title="Calls"
      description="Choose which calls record on their own and who can see them afterwards."
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
                      <CheckboxRow
                        label={option.label}
                        description={option.description}
                        checked={recordsByDefault(settings(), option.kind)}
                        disabled={isRecordingBlocked(settings(), option.kind)}
                        disabledReason="Your team admins have blocked recording these calls."
                        onChange={(value) =>
                          calls.setRecordByDefault(option.kind, value)
                        }
                      />
                    )}
                  </For>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection
                title="Share by default"
                description="Who can open the recording, transcript, and AI notes of calls you start once they end. Huddles shared with your team begin with “Share with team” on, and anyone in the huddle can turn it off."
              >
                <SettingsCard>
                  <For each={RECORDING_KINDS}>
                    {(option) => (
                      <SelectRow
                        label={option.label}
                        controlLabel={`${option.label} audience`}
                        description={option.description}
                        options={option.audiences.map((audience) => ({
                          id: audience,
                          name: SHARE_AUDIENCE_LABELS[audience],
                        }))}
                        value={shareAudience(settings(), option.kind)}
                        disabled={
                          option.kind === 'huddles' &&
                          isHuddleSharingBlocked(settings())
                        }
                        disabledReason="Your team admins have blocked sharing huddles with the team."
                        note={huddleBlockNote(settings(), option.kind)}
                        onChange={(audience) =>
                          calls.setShareByDefault(
                            option.kind,
                            audience as ShareAudience
                          )
                        }
                      />
                    )}
                  </For>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection
                title="1:1 privacy"
                description="Applies to DM huddles and 1:1 meetings, whoever starts them."
              >
                <SettingsCard>
                  <CheckboxRow
                    label="Block all my 1:1s"
                    description="They aren't recorded or transcribed, whatever the other person's settings say, and both of you see why. Stops applying once a third teammate or anyone from outside your team joins a meeting."
                    checked={settings().refuseOneOnOneRecording}
                    disabled={false}
                    onChange={(value) =>
                      calls.setRefuseOneOnOneRecording(value)
                    }
                  />
                </SettingsCard>
              </SettingsSection>

              <Show when={settings().team}>
                {(team) => (
                  <SettingsSection
                    title="Team policy"
                    description="Block recording or sharing for everyone on your team. Blocks apply whatever each person's settings say."
                    actions={
                      <Show when={!team().canEdit}>
                        <span class="text-xs text-ink-muted">Admins only</span>
                      </Show>
                    }
                  >
                    <SettingsCard>
                      <For each={RECORDING_KINDS}>
                        {(option) => (
                          <CheckboxRow
                            label={option.blockLabel}
                            description={option.description}
                            checked={team().recordingBlocked[option.kind]}
                            disabled={!team().canEdit}
                            disabledReason={ADMINS_ONLY}
                            onChange={(blocked) =>
                              calls.setRecordingBlocked(option.kind, blocked)
                            }
                          />
                        )}
                      </For>
                      <CheckboxRow
                        label="Block sharing huddles"
                        description="No one's huddles, DM huddles included, are shared with the team, including huddles already running."
                        checked={team().huddleSharingBlocked}
                        disabled={!team().canEdit}
                        disabledReason={ADMINS_ONLY}
                        onChange={(blocked) =>
                          calls.setHuddleSharingBlocked(blocked)
                        }
                      />
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
