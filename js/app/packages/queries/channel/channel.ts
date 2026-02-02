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
    gcTime: 0,
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

type WithChannelId<T> = T & { channelId: string };

export type UpdateChannelNameContext = {
  previousName: string | null | undefined;
  previousUpdatedAt: string;
};

/**
 * Optimistically update the channel name.
 * Returns minimal context: only the previous name and timestamp.
 */
export function optimisticUpdateChannelName(
  vars: WithChannelId<{ name: string }>
): UpdateChannelNameContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: UpdateChannelNameContext | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      context = {
        previousName: prev.channel.name,
        previousUpdatedAt: prev.channel.updated_at,
      };

      return {
        ...prev,
        channel: {
          ...prev.channel,
          name: vars.name,
          updated_at: new Date().toISOString(),
        },
      };
    }
  );

  return context;
}

/**
 * Rollback an optimistic channel name update.
 */
export function rollbackUpdateChannelName(
  channelId: string,
  context: UpdateChannelNameContext
): void {
  const queryKey = channelKeys.withID(channelId).queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      return {
        ...prev,
        channel: {
          ...prev.channel,
          name: context.previousName,
          updated_at: context.previousUpdatedAt,
        },
      };
    }
  );
}

export function invalidateChannelWithID(channelID: string) {
  queryClient.invalidateQueries({
    queryKey: channelKeys.withID(channelID).queryKey,
  });
}

/**
 * Marks the channel query as stale without triggering an immediate refetch.
 * Uses `refetchType: 'inactive'` so queries only refetch when they become active again.
 * Use this after WebSocket updates to ensure eventual consistency without redundant fetches.
 */
export function softInvalidateChannelWithID(channelID: string) {
  queryClient.invalidateQueries({
    queryKey: channelKeys.withID(channelID).queryKey,
    refetchType: 'inactive',
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
