import {
  useCallSettingsQuery,
  useUpdateCallSettingsMutation,
  useUpdateTeamCallPolicyMutation,
} from '@queries/call/call-settings';
import type { CallSettings as CallSettingsResponse } from '@service-call/client';
import type { CallSettingsCapabilities } from './context/call-settings-context';
import type { CallSettings } from './core/call-settings';

function toCallSettings(settings: CallSettingsResponse): CallSettings {
  return {
    recordByDefault: settings.recordByDefault,
    shareByDefault: settings.shareByDefault,
    refuseOneOnOneRecording: settings.refuseOneOnOneRecording,
    team: settings.team ?? null,
  };
}

/** Production capabilities backed by the call service. */
export function createAppCallSettings(): CallSettingsCapabilities {
  const query = useCallSettingsQuery();
  const update = useUpdateCallSettingsMutation();
  const team = useUpdateTeamCallPolicyMutation();
  return {
    createSource: () => ({
      // Gated on success so a pending read never suspends the settings page.
      settings: () =>
        query.isSuccess ? toCallSettings(query.data) : undefined,
      error: () => query.isError,
    }),
    setRecordByDefault: (kind, value) =>
      update.mutate({ recordByDefault: { [kind]: value } }),
    setShareByDefault: (kind, audience) =>
      update.mutate({ shareByDefault: { [kind]: audience } }),
    setRefuseOneOnOneRecording: (value) =>
      update.mutate({ refuseOneOnOneRecording: value }),
    setRecordingBlocked: (kind, blocked) =>
      team.mutate({ recordingBlocked: { [kind]: blocked } }),
    setHuddleSharingBlocked: (blocked) =>
      team.mutate({ huddleSharingBlocked: blocked }),
  };
}
