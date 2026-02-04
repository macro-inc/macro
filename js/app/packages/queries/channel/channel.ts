import {
  catchToResult,
  isErr,
  type MaybeResult,
  ok,
  throwOnErr,
} from '@core/util/maybeResult';
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

export function channelQueryOptions(channelId: string): ChannelQueryOptions {
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

type WithChannelId<T> = T & { channelId: string };

export type UpdateChannelNameContext = {
  previousName: string | null | undefined;
  previousUpdatedAt: string;
};

/** Helper to update channel name in both single channel and list queries. */
function updateChannelNameInQueries(
  channelId: string,
  name: string | null | undefined,
  updatedAt: string
): void {
  const queryKey = channelKeys.withID(channelId).queryKey;
  const listQueryKey = channelKeys.listChannels.queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      return {
        ...prev,
        channel: {
          ...prev.channel,
          name,
          updated_at: updatedAt,
        },
      };
    }
  );

  queryClient.setQueriesData(
    { queryKey: listQueryKey },
    (prev: ApiChannelWithLatest[] | undefined) => {
      if (!prev) return prev;

      return prev.map((channel) =>
        channel.id === channelId
          ? { ...channel, name, updated_at: updatedAt }
          : channel
      );
    }
  );
}

/**
 * Optimistically update the channel name.
 * Returns context needed to rollback the update.
 */
export function optimisticUpdateChannelName(
  vars: WithChannelId<{ name: string }>
): UpdateChannelNameContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  const listQueryKey = channelKeys.listChannels.queryKey;

  queryClient.cancelQueries({ queryKey });
  queryClient.cancelQueries({ queryKey: listQueryKey });

  let context: UpdateChannelNameContext | undefined;

  // Capture previous state for rollback
  const prev = queryClient.getQueryData<GetChannelResponse>(queryKey);
  if (prev) {
    context = {
      previousName: prev.channel.name,
      previousUpdatedAt: prev.channel.updated_at,
    };
  }

  const now = new Date().toISOString();
  updateChannelNameInQueries(vars.channelId, vars.name, now);

  return context;
}

/** Rollback an optimistic channel name update. */
export function rollbackUpdateChannelName(
  channelId: string,
  context: UpdateChannelNameContext
): void {
  updateChannelNameInQueries(
    channelId,
    context.previousName,
    context.previousUpdatedAt
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
