import { throwOnErr } from '@core/util/maybeResult';
import {
  commsServiceClient,
  type ApiChannelParticipant,
} from '@service-comms/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { channelKeys } from './keys';

export function channelParticipantsQueryOptions(channelId: string) {
  return {
    queryKey: channelKeys.participants(channelId).queryKey,
    queryFn: async (): Promise<ApiChannelParticipant[]> => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.getChannelParticipants({
            channel_id: channelId,
          })
      );
    },
    staleTime: Infinity,
  };
}

export function useChannelParticipantsQuery(channelId: Accessor<string>) {
  return useQuery(() => channelParticipantsQueryOptions(channelId()));
}

export function softInvalidateChannelParticipants(channelId: string) {
  queryClient.invalidateQueries({
    queryKey: channelKeys.participants(channelId).queryKey,
    refetchType: 'inactive',
  });
}
