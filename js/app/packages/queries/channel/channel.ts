import {
  catchToResult,
  isErr,
  type MaybeResult,
  ok,
  throwOnErr,
} from '@core/util/maybeResult';
import { queryKeys } from '@macro-entity';
import { commsServiceClient } from '@service-comms/client';
import type { getChannelResponseError } from '@service-comms/generated/client';
import type {
  ApiChannelWithLatest,
  GetChannelResponse,
} from '@service-comms/generated/models';
import {
  type QueryClient,
  type UseBaseQueryOptions,
  useQuery,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { channelKeys } from './keys';

type ChannelQueryOptions = UseBaseQueryOptions<
  GetChannelResponse,
  getChannelResponseError
>;

function channelQueryOptions(channelId: string): ChannelQueryOptions {
  return {
    queryKey: channelKeys.withID(channelId).queryKey,
    queryFn: async () => {
      const result = await throwOnErr(
        async () =>
          await commsServiceClient.getChannel({
            channel_id: channelId,
          })
      );

      return result;
    },
    staleTime: 0,
  };
}

export async function fetchAndCacheChannel(
  channelId: string
): Promise<MaybeResult<string, { channel: GetChannelResponse }>> {
  const result = await catchToResult(
    async () =>
      await queryClient.ensureQueryData(channelQueryOptions(channelId))
  );

  if (isErr(result)) {
    return result;
  }

  return ok({ channel: result[1] });
}

export function useChannelQuery(
  channelId: Accessor<string>,
  options?: Accessor<Omit<ChannelQueryOptions, 'queryKey' | 'queryFn'>>,
  queryClient?: Accessor<QueryClient>
) {
  return useQuery(() => {
    return {
      initialData: undefined,
      ...options?.(),
      ...channelQueryOptions(channelId()),
    };
  }, queryClient);
}

export function optimisticUpdateChannelName(
  channelID: string,
  newName: string
) {
  const queryKey = channelKeys.withID(channelID).queryKey;
  queryClient.cancelQueries({ queryKey });

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return;

      const next = {
        ...prev,
        channel: {
          ...prev.channel,
          name: newName,
          updatedAt: new Date().toISOString(),
        },
      };

      return { ...next };
    }
  );
}

export function invalidateChannelWithID(channelID: string) {
  queryClient.invalidateQueries({
    queryKey: channelKeys.withID(channelID).queryKey,
  });
}

export function optimisticUpdateChannelViewedAt(channelId: string) {
  const now = new Date().toISOString();

  queryClient.setQueryData<ApiChannelWithLatest[]>(
    queryKeys.all.channel,
    (old) => {
      if (!old) return old;
      return old.map((channel) =>
        channel.id === channelId ? { ...channel, viewed_at: now } : channel
      );
    }
  );
}
