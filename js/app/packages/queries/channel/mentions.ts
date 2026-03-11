import { throwOnErr } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { channelKeys } from './keys';

export function useMentionsQuery(channelId: Accessor<string>) {
  return useQuery(() => {
    return {
      queryKey: channelKeys.mentions(channelId()).queryKey,
      queryFn: () =>
        throwOnErr(() =>
          commsServiceClient.getMentions({ channel_id: channelId() })
        ),
      staleTime: Infinity,
      refetchOnMount: false,
    };
  });
}
