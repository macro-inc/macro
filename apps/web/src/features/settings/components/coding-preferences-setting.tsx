import { toast } from '@core/component/Toast/Toast';
import {
  useCodingPreferencesQuery,
  useSetCodingPreferencesMutation,
} from '@queries/agents/coding-preferences';
import type { CodingPreferencesBody } from '@service-agent-harness/client';
import { ToggleSwitch } from '@ui';
import { SettingsCard, SettingsRow, SettingsSection } from '../primitives';

/** What the user's new coding sessions do beyond their assignment. */
export function CodingPreferencesSetting() {
  const preferences = useCodingPreferencesQuery();
  const setPreferences = useSetCodingPreferencesMutation();

  const toggle = async (
    current: CodingPreferencesBody,
    preference: keyof CodingPreferencesBody,
    enabled: boolean
  ) => {
    try {
      await setPreferences.mutateAsync({ ...current, [preference]: enabled });
    } catch {
      toast.failure('Could not update coding preferences');
    }
  };

  const PreferenceRow = (props: {
    preference: keyof CodingPreferencesBody;
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
          void toggle(preferences.data, props.preference, enabled);
        }}
      />
    </SettingsRow>
  );

  return (
    <SettingsSection title="Coding sessions">
      <SettingsCard>
        <PreferenceRow
          preference="createTasks"
          label="Create tasks"
          description="Link each coding session to a Macro task"
        />
        <PreferenceRow
          preference="openPullRequests"
          label="Open pull requests"
          description="Deliver coding work as a pull request"
        />
      </SettingsCard>
    </SettingsSection>
  );
}
