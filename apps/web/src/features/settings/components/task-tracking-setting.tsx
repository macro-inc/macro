import { toast } from '@core/component/Toast/Toast';
import {
  useSetTaskTrackingMutation,
  useTaskTrackingQuery,
} from '@queries/agents/task-tracking';
import { ToggleSwitch } from '@ui';
import { Show } from 'solid-js';
import { SettingsCard, SettingsRow, SettingsSection } from '../primitives';

const LABEL = 'Track coding sessions with tasks';

/** The user's opt-in for coding agents to work through Macro tasks. */
export function TaskTrackingSetting() {
  const taskTracking = useTaskTrackingQuery();
  const setTaskTracking = useSetTaskTrackingMutation();

  const toggle = async (enabled: boolean) => {
    try {
      await setTaskTracking.mutateAsync(enabled);
    } catch {
      toast.failure('Could not update task tracking');
    }
  };

  return (
    <SettingsSection title="Coding sessions">
      <SettingsCard>
        <SettingsRow
          label={LABEL}
          description="Coding agents search your workspace for related tasks first, ask before picking up existing or shipped work, link the session to a task, and open a pull request linked to it."
        >
          <ToggleSwitch
            size="md"
            label={LABEL}
            labelClass="sr-only"
            checked={taskTracking.isSuccess && taskTracking.data.enabled}
            disabled={!taskTracking.isSuccess}
            onChange={(enabled) => void toggle(enabled)}
          />
        </SettingsRow>
        <Show when={taskTracking.isError}>
          <p class="px-4 pb-3 text-xs text-negative">
            Could not load this setting. Try refreshing this page.
          </p>
        </Show>
      </SettingsCard>
    </SettingsSection>
  );
}
