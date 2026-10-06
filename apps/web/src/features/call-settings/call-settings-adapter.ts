import {
  useCallRecordingSettingsQuery,
  useUpdateRecordingDefaultsMutation,
  useUpdateTeamRecordingPolicyMutation,
} from '@queries/call/recording-settings';
import type { CallRecordingSettings } from '@service-call/client';
import type { CallSettingsCapabilities } from './context/call-settings-context';
import type { RecordingSettings } from './core/recording-kinds';

function toRecordingSettings(
  settings: CallRecordingSettings
): RecordingSettings {
  return {
    recordByDefault: settings.recordByDefault,
    team: settings.team ?? null,
  };
}

/** Production capabilities backed by the call service. */
export function createAppCallSettings(): CallSettingsCapabilities {
  const query = useCallRecordingSettingsQuery();
  const defaults = useUpdateRecordingDefaultsMutation();
  const team = useUpdateTeamRecordingPolicyMutation();
  return {
    createSource: () => ({
      // Gated on success so a pending read never suspends the settings page.
      settings: () =>
        query.isSuccess ? toRecordingSettings(query.data) : undefined,
      error: () => query.isError,
    }),
    setRecordByDefault: (kind, value) =>
      defaults.mutate({ recordByDefault: { [kind]: value } }),
    setTeamBlock: (kind, blocked) =>
      team.mutate({ blocked: { [kind]: blocked } }),
  };
}
