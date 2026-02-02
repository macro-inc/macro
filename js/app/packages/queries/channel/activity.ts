import { useMutation, useQuery } from '@tanstack/solid-query';
import { channelKeys } from './keys';
import { throwOnErr } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type {
  ActivityType,
  ApiActivity as ChannelsActivity,
} from '@service-comms/generated/models';
import { queryClient } from '@queries/client';

export function useChannelsActivityQuery() {
  return useQuery(() => ({
    queryKey: channelKeys.activity.queryKey,
    queryFn: async () => await throwOnErr(commsServiceClient.getActivity),
  }));
}

type UpdateChannelActivityMutationVars = {
  channelId: string;
  activityType: ActivityType;
};

export function useUpdateChannelsActivityMutation(
  callbacks?: MutationCallbacks<
    ChannelsActivity,
    Error,
    UpdateChannelActivityMutationVars
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: UpdateChannelActivityMutationVars) =>
      await throwOnErr(
        async () =>
          await commsServiceClient.postActivity({
            channel_id: vars.channelId,
            activity_type: vars.activityType,
          })
      ),
    ...withCallbacks<
      ChannelsActivity,
      Error,
      UpdateChannelActivityMutationVars
    >(
      {
        onError(error) {
          console.error('failed to update activity for channel', error);
        },
      },
      callbacks
    ),
  }));
}

export function invalidateChannelsActivity() {
  queryClient.invalidateQueries({ queryKey: channelKeys.activity.queryKey });
}
