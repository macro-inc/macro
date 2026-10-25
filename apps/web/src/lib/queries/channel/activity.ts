import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { storageServiceClient } from '@service-storage/client';
import type { ActivityType } from '@service-storage/generated/schemas/activityType';
import type { ApiActivity as ChannelsActivity } from '@service-storage/generated/schemas/apiActivity';
import { recordChannelActivity } from '@service-storage/graphql-channel-activity';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { channelKeys } from './keys';

function fetchChannelsActivity() {
  return throwOnErr(storageServiceClient.getActivity);
}

export function useChannelsActivityQuery(
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => ({
    queryKey: channelKeys.activity.queryKey,
    queryFn: fetchChannelsActivity,
    enabled: enabled(),
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
      await recordChannelActivity(vars),
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
  queryClient.invalidateQueries({
    queryKey: channelKeys.activity.queryKey,
  });
}
