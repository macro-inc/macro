import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { commsServiceClient } from '@service-comms/client';
import { useQuery } from '@tanstack/solid-query';
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
