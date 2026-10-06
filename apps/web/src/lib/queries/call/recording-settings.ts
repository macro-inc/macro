import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type CallRecordingSettings,
  callServiceClient,
  type UpdateRecordingDefaultsRequest,
  type UpdateTeamRecordingPolicyRequest,
} from '@service-call/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { callKeys } from './keys';

/** The viewer's recording defaults and their team's recording blocks. */
export function useCallRecordingSettingsQuery() {
  return useQuery(() => ({
    queryKey: callKeys.recordingSettings.queryKey,
    queryFn: () => throwOnErr(() => callServiceClient.getRecordingSettings()),
  }));
}

type RecordingSettingsPatch = (
  settings: CallRecordingSettings
) => CallRecordingSettings;

/**
 * Shows a settings change at once, then replaces it with what the server
 * stored. A failed save restores the previous settings.
 */
function optimisticRecordingSettings<Args>(
  patch: (args: Args) => RecordingSettingsPatch,
  failure: string
) {
  const key = callKeys.recordingSettings.queryKey;
  return {
    onMutate: async (args: Args) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CallRecordingSettings>(key);
      if (previous) queryClient.setQueryData(key, patch(args)(previous));
      return { previous };
    },
    onError: (
      error: Error,
      _args: Args,
      context: { previous?: CallRecordingSettings } | undefined
    ) => {
      console.error(failure, error);
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.failure(failure);
    },
    onSuccess: (settings: CallRecordingSettings) => {
      queryClient.setQueryData(key, settings);
    },
  };
}

export function useUpdateRecordingDefaultsMutation() {
  return useMutation(() => ({
    mutationFn: (body: UpdateRecordingDefaultsRequest) =>
      throwOnErr(() => callServiceClient.updateRecordingDefaults(body)),
    ...optimisticRecordingSettings<UpdateRecordingDefaultsRequest>(
      (body) => (settings) => ({
        ...settings,
        recordByDefault: {
          ...settings.recordByDefault,
          ...definedKinds(body.recordByDefault),
        },
      }),
      'Failed to update recording defaults'
    ),
  }));
}

export function useUpdateTeamRecordingPolicyMutation() {
  return useMutation(() => ({
    mutationFn: (body: UpdateTeamRecordingPolicyRequest) =>
      throwOnErr(() => callServiceClient.updateTeamRecordingPolicy(body)),
    ...optimisticRecordingSettings<UpdateTeamRecordingPolicyRequest>(
      (body) => (settings) =>
        settings.team
          ? {
              ...settings,
              team: {
                ...settings.team,
                blocked: {
                  ...settings.team.blocked,
                  ...definedKinds(body.blocked),
                },
              },
            }
          : settings,
      'Failed to update team recording policy'
    ),
  }));
}

/** The kinds a patch sets; omitted kinds stay as they are. */
function definedKinds<T extends object>(patch: T) {
  return Object.fromEntries(
    Object.entries(patch).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
    )
  );
}
