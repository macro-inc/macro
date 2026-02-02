import { useQuery } from '@tanstack/solid-query';
import { channelKeys } from './keys';
import { throwOnErr } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import { queryClient } from '@queries/client';

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
