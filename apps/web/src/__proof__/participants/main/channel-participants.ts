// Copy of main's apps/web/src/lib/queries/channel/channel-participants.ts at 8f161035c063cb7d5ffcd1939fbbb0ecaa6612f8, verbatim below the marker
// except the import lines listed in check-copies.sh (paths that main resolved
// relative to its own directory). The proof runner checks this.
// ---- verbatim below ----
import { throwOnErr } from '@core/util/result';
import type { ApiChannelParticipant } from '@service-storage/generated/schemas/apiChannelParticipant';
import {
  storageServiceClient,
} from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '@queries/client';
import { channelKeys } from './keys';

export function channelParticipantsQueryOptions(channelId: string) {
  return {
    queryKey: channelKeys.participants(channelId).queryKey,
    queryFn: async (): Promise<ApiChannelParticipant[]> => {
      return await throwOnErr(
        async () =>
          await storageServiceClient.getChannelParticipants({
            channel_id: channelId,
          })
      );
    },
    staleTime: Infinity,
  };
}

export function useChannelParticipantsQuery(channelId: Accessor<string>) {
  return useQuery(() => ({
    ...channelParticipantsQueryOptions(channelId()),
    enabled: !!channelId(),
  }));
}

export function invalidateChannelParticipants(channelId: string) {
  return queryClient.invalidateQueries({
    queryKey: channelKeys.participants(channelId).queryKey,
  });
}

export function softInvalidateChannelParticipants(channelId: string) {
  return queryClient.invalidateQueries({
    queryKey: channelKeys.participants(channelId).queryKey,
    refetchType: 'inactive',
  });
}
