import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { commsServiceClient } from '@service-comms/client';
import { storageServiceClient } from '@service-storage/client';
import type { CreateChannelRequest } from '@service-storage/generated/schemas/createChannelRequest';
import type { CreateChannelResponse } from '@service-storage/generated/schemas/createChannelResponse';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { channelKeys } from './keys';

export function useListChannelsQuery() {
  return useQuery(() => ({
    queryKey: channelKeys.listChannels.queryKey,
    queryFn: async () => await throwOnErr(commsServiceClient.getChannels),
  }));
}

export function invalidateListChannels() {
  return queryClient.invalidateQueries({
    queryKey: channelKeys.listChannels.queryKey,
  });
}

/**
 * Create a channel. Invalidates the channel list on settle.
 */
export function useCreateChannelMutation(
  callbacks?: MutationCallbacks<
    CreateChannelResponse,
    Error,
    CreateChannelRequest,
    undefined
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: CreateChannelRequest) => {
      return await throwOnErr(async () =>
        storageServiceClient.createChannel(vars)
      );
    },
    ...withCallbacks<
      CreateChannelResponse,
      Error,
      CreateChannelRequest,
      undefined
    >(
      {
        onError(error) {
          console.error('failed to create channel', error);
        },
        onSettled: () => void invalidateListChannels(),
      },
      callbacks
    ),
  }));
}
