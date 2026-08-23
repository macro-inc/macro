import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { storageServiceClient } from '@service-storage/client';
import type { ActivityType } from '@service-storage/generated/schemas/activityType';
import type { ApiActivity as ChannelsActivity } from '@service-storage/generated/schemas/apiActivity';
import { recordChannelActivity } from '@service-storage/graphql-channel-activity';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { channelKeys } from './keys';

export function useChannelsActivityQuery() {
  return useQuery(() => ({
    queryKey: channelKeys.activity.queryKey,
    queryFn: async () => await throwOnErr(storageServiceClient.getActivity),
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
        onSuccess(activity) {
          applyChannelActivity(activity);
        },
        onError(error) {
          console.error('failed to update activity for channel', error);
        },
      },
      callbacks
    ),
  }));
}

/**
 * Fold a recorded activity into the cached list in place.
 *
 * The mutation returns exactly the row shape the list is built from, so
 * refetching the whole list to learn what was just written is wasted work —
 * and a channel is marked viewed both on open and on close, so a switch between
 * two channels used to fire three of these refetches within a few milliseconds.
 */
export function applyChannelActivity(activity: ChannelsActivity) {
  queryClient.setQueryData<ChannelsActivity[]>(
    channelKeys.activity.queryKey,
    (current) => {
      // Nothing cached yet: the query fetches the full list when it mounts, so
      // seeding it with a single row here would look like a complete answer.
      if (!current) return current;

      const index = current.findIndex(
        (entry) => entry.channel_id === activity.channel_id
      );
      if (index === -1) return [...current, activity];

      const next = [...current];
      next[index] = activity;
      return next;
    }
  );
}
