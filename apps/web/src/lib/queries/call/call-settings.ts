import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type CallSettings,
  callServiceClient,
  type UpdateCallSettingsRequest,
  type UpdateTeamCallPolicyRequest,
} from '@service-call/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { callKeys } from './keys';

/** The viewer's call settings and their team's call policy. */
export function useCallSettingsQuery() {
  return useQuery(() => ({
    queryKey: callKeys.settings.queryKey,
    queryFn: () => throwOnErr(() => callServiceClient.getCallSettings()),
  }));
}

/** Shared by every settings mutation, so each can see the others in flight. */
const settingsMutationKey = [...callKeys.settings.queryKey, 'update'];

/**
 * Shows a settings change at once, then replaces it with what the server
 * stored once no other change is in flight; a snapshot from an earlier save
 * would undo a later change still showing. A failed save restores the
 * previous settings, or refetches them while another change is in flight.
 */
function optimisticCallSettings<Args>(
  patch: (args: Args, settings: CallSettings) => CallSettings,
  failure: string
) {
  const key = callKeys.settings.queryKey;
  return {
    onMutate: async (args: Args) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CallSettings>(key);
      if (previous) queryClient.setQueryData(key, patch(args, previous));
      return { previous };
    },
    onError: (
      error: Error,
      _args: Args,
      context: { previous?: CallSettings } | undefined
    ) => {
      console.error(failure, error);
      // Restoring this save's snapshot would also undo a change still in
      // flight, so refetch instead.
      if (queryClient.isMutating({ mutationKey: settingsMutationKey }) > 1)
        void queryClient.invalidateQueries({ queryKey: key });
      else if (context?.previous)
        queryClient.setQueryData(key, context.previous);
      toast.failure(failure);
    },
    onSuccess: (settings: CallSettings) => {
      if (queryClient.isMutating({ mutationKey: settingsMutationKey }) <= 1)
        queryClient.setQueryData(key, settings);
    },
  };
}

export function useUpdateCallSettingsMutation() {
  return useMutation(() => ({
    mutationKey: settingsMutationKey,
    mutationFn: (body: UpdateCallSettingsRequest) =>
      throwOnErr(() => callServiceClient.updateCallSettings(body)),
    ...optimisticCallSettings<UpdateCallSettingsRequest>(
      (body, settings) => ({
        ...settings,
        recordByDefault: {
          ...settings.recordByDefault,
          ...definedFields(body.recordByDefault ?? {}),
        },
        shareByDefault: {
          ...settings.shareByDefault,
          ...definedFields(body.shareByDefault ?? {}),
        },
        refuseOneOnOneRecording:
          body.refuseOneOnOneRecording ?? settings.refuseOneOnOneRecording,
      }),
      'Failed to update call settings'
    ),
  }));
}

export function useUpdateTeamCallPolicyMutation() {
  return useMutation(() => ({
    mutationKey: settingsMutationKey,
    mutationFn: (body: UpdateTeamCallPolicyRequest) =>
      throwOnErr(() => callServiceClient.updateTeamCallPolicy(body)),
    ...optimisticCallSettings<UpdateTeamCallPolicyRequest>(
      (body, settings) =>
        settings.team
          ? {
              ...settings,
              team: {
                ...settings.team,
                recordingBlocked: {
                  ...settings.team.recordingBlocked,
                  ...definedFields(body.recordingBlocked ?? {}),
                },
                huddleSharingBlocked:
                  body.huddleSharingBlocked ??
                  settings.team.huddleSharingBlocked,
              },
            }
          : settings,
      'Failed to update team call policy'
    ),
  }));
}

/** The fields a patch sets; omitted ones stay as they are. */
function definedFields<T extends object>(
  patch: T
): Partial<{ [K in keyof T]: NonNullable<T[K]> }> {
  return Object.fromEntries(
    Object.entries(patch).filter((entry) => entry[1] != null)
  ) as Partial<{ [K in keyof T]: NonNullable<T[K]> }>;
}
