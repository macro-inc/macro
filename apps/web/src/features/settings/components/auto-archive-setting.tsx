import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  useAutoArchivePreferencesQuery,
  useSetAutoArchivePreferencesMutation,
} from '@queries/agents/auto-archive-preferences';
import type { AutoArchivePreferencesBody } from '@service-agent-harness/client';
import { ToggleSwitch } from '@ui';
import { SettingsCard, SettingsRow, SettingsSection } from '../primitives';

/** When the user's agent sessions archive themselves; each session can override. */
export function AutoArchiveSetting() {
  const preferences = useAutoArchivePreferencesQuery();
  const setPreferences = useSetAutoArchivePreferencesMutation();

  const toggle = async (
    current: AutoArchivePreferencesBody,
    preference: keyof AutoArchivePreferencesBody,
    enabled: boolean
  ) => {
    try {
      await setPreferences.mutateAsync({ ...current, [preference]: enabled });
    } catch {
      toast.failure('Could not update auto-archive');
    }
  };

  const PreferenceRow = (props: {
    preference: keyof AutoArchivePreferencesBody;
    label: string;
    description: string;
  }) => (
    <SettingsRow label={props.label} description={props.description}>
      <ToggleSwitch
        size="md"
        label={props.label}
        labelClass="sr-only"
        checked={preferences.isSuccess && preferences.data[props.preference]}
        disabled={!preferences.isSuccess}
        onChange={(enabled) => {
          if (!preferences.isSuccess) return;
          fireAndForget(
            toggle(preferences.data, props.preference, enabled),
            'auto-archive-preferences'
          );
        }}
      />
    </SettingsRow>
  );

  return (
    <SettingsSection
      title="Auto-archive"
      description="A session you unarchive is never archived automatically again."
    >
      <SettingsCard>
        <PreferenceRow
          preference="onPullRequestMerged"
          label="When its pull requests merge"
          description="Once every linked pull request is closed and at least one merged"
        />
        <PreferenceRow
          preference="onRuntimeClosed"
          label="When its machine session closes"
          description="Once the session running it is closed on purpose, like closing its Herdr tab"
        />
      </SettingsCard>
    </SettingsSection>
  );
}
