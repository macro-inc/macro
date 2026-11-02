import { analytics } from '@app/lib/analytics';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/index';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import {
  type MessageResponse,
  storageServiceClient,
} from '@service-storage/client';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import type { CreateChannelRequest } from '@service-storage/generated/schemas/createChannelRequest';
import type { CreateChannelResponse } from '@service-storage/generated/schemas/createChannelResponse';
import type { PatchChannelRequest } from '@service-storage/generated/schemas/patchChannelRequest';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  assertQueryAccount,
  currentQueryAccount,
  isCurrentQueryAccount,
  mutationQueryAccount,
  type QueryAccount,
} from '../auth/account-scope';
import { useQueryAccount } from '../auth/use-query-account';
import {
  assertContactCacheScope,
  readContactCacheScope,
} from '../contacts/cache-scope';
import { createContactQueryEpoch } from '../contacts/query-epoch';
import { invalidateChannelParticipants } from './channel-participants';
import {
  type CachedGraphqlChannel,
  readCachedGraphqlChannels,
} from './graphql';
import { channelKeys } from './keys';

const CHANNEL_LIST_PAGE_SIZE = 100;

export async function fetchAllChannels(
  signal?: AbortSignal,
  account = currentQueryAccount()
): Promise<ApiChannelWithLatest[]> {
  const channels: ApiChannelWithLatest[] = [];
  let cursor: string | undefined;

  do {
    assertQueryAccount(account);
    signal?.throwIfAborted();
    const page = await throwOnErr(() =>
      storageServiceClient.getChannels({
        cursor,
        limit: CHANNEL_LIST_PAGE_SIZE,
        signal,
      })
    );
    assertQueryAccount(account);
    signal?.throwIfAborted();
    channels.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);

  return channels;
}

export function listChannelsQueryOptions(
  account: QueryAccount | undefined,
  enabled: boolean
) {
  return queryOptions({
    queryKey: channelKeys.listChannels(account?.userId).queryKey,
    queryFn: ({ signal }) => fetchAllChannels(signal, account),
    enabled: !!account && enabled,
  });
}

export function useListChannelsQuery(enabled: Accessor<boolean> = () => true) {
  const account = useQueryAccount();
  return useQuery(() => listChannelsQueryOptions(account(), enabled()));
}

/** The viewer's channel list: cached when loaded, with account/session admission. */
export async function loadChannelList(): Promise<ApiChannelWithLatest[]> {
  const account = currentQueryAccount();
  assertQueryAccount(account);
  const channels = await queryClient.ensureQueryData(listChannelsQueryOptions(account, true));
  assertQueryAccount(account);
  return channels;
}

// Resolved account/generation inputs, not component accessors, are retained.
export function cachedGraphqlChannelsQueryOptions(
  cacheHost: CacheHost | undefined,
  account: QueryAccount | undefined,
  generation: number
) {
  return queryOptions({
    queryKey: channelKeys.quickAccessGraphql(
      cacheHost?.clientId ?? 'disabled',
      account?.userId,
      generation
    ).queryKey,
    queryFn: async ({ signal }): Promise<CachedGraphqlChannel[]> => {
      assertQueryAccount(account);
      if (!cacheHost) return [];
      const scope = await readContactCacheScope(
        cacheHost,
        account.userId,
        signal
      );
      if (!scope) return [];
      const channels = await readCachedGraphqlChannels(cacheHost);
      await assertContactCacheScope(cacheHost, account.userId, scope, signal);
      assertQueryAccount(account);
      return channels;
    },
    enabled: !!account && cacheHost !== undefined,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}

/** Reads the recent Quick Access channel list from the normalized GraphQL cache. */
export function useCachedGraphqlChannelsQuery(
  cacheHost: Accessor<CacheHost | undefined>
) {
  const account = useQueryAccount();
  const scope = () => ({ userId: account()?.userId, host: cacheHost() });
  const generation = createContactQueryEpoch(scope);
  return useQuery(() => {
    const host = cacheHost();
    return cachedGraphqlChannelsQueryOptions(
      host?.disabled ? undefined : host,
      account(),
      generation.epoch()
    );
  });
}

export function invalidateListChannels(account = currentQueryAccount()) {
  if (!isCurrentQueryAccount(account)) return Promise.resolve();
  return queryClient.invalidateQueries({
    queryKey: channelKeys.listChannels(account.userId).queryKey,
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
  const account = useQueryAccount();
  return useMutation(() => ({
    gcTime: 0,
    meta: { queryAccount: account() },
    mutationFn: async (vars: CreateChannelRequest, context) => {
      assertQueryAccount(mutationQueryAccount(context));
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
        onSuccess: (data) => {
          analytics.track('create_entity', {
            entityType: 'channel',
            entityId: data.id,
          });
        },
        onSettled: (_data, _error, _variables, _result, context) => {
          const owner = mutationQueryAccount(context);
          if (owner)
            fireAndForget(invalidateListChannels(owner), 'channel-list');
        },
      },
      callbacks
    ),
  }));
}

export type PatchChannelParams = PatchChannelRequest & { channelId: string };
type PatchChannelCallbacks = MutationCallbacks<
  MessageResponse,
  Error,
  PatchChannelParams
>;

function updateCachedChannel(
  channels: ApiChannelWithLatest[] | undefined,
  vars: PatchChannelParams
): ApiChannelWithLatest[] | undefined {
  return channels?.map((channel) => {
    if (channel.id !== vars.channelId) return channel;

    return {
      ...channel,
      channel_type:
        vars.convert_to_team_channel === true
          ? ChannelType.team
          : channel.channel_type,
      auto_join_team:
        typeof vars.auto_join_team === 'boolean'
          ? vars.auto_join_team
          : channel.auto_join_team,
    };
  });
}

/** Patch channel settings and refresh channel/participant state. */
export function usePatchChannelMutation(callbacks?: PatchChannelCallbacks) {
  const account = useQueryAccount();
  return useMutation(() => ({
    gcTime: 0,
    meta: { queryAccount: account() },
    mutationFn: async (
      { channelId, ...request }: PatchChannelParams,
      context
    ) => {
      assertQueryAccount(mutationQueryAccount(context));
      return await throwOnErr(() =>
        storageServiceClient.patchChannel({ channel_id: channelId, ...request })
      );
    },
    ...withCallbacks<MessageResponse, Error, PatchChannelParams>(
      {
        onSuccess: async (_data, vars, _result, context) => {
          const owner = mutationQueryAccount(context);
          if (!isCurrentQueryAccount(owner)) return;
          queryClient.setQueryData<ApiChannelWithLatest[]>(
            channelKeys.listChannels(owner.userId).queryKey,
            (channels) => updateCachedChannel(channels, vars)
          );
          if (typeof vars.auto_join_team === 'boolean') {
            await invalidateChannelParticipants(vars.channelId);
          }
          toast.success(
            vars.convert_to_team_channel === true
              ? 'Channel converted to a team channel'
              : vars.auto_join_team
                ? 'Team auto-join enabled'
                : 'Team auto-join disabled'
          );
        },
        onError: (error) => {
          console.error('failed to update channel settings', error);
          toast.failure('Failed to update channel settings');
        },
        onSettled: (_data, _error, _variables, _result, context) => {
          const owner = mutationQueryAccount(context);
          if (owner)
            fireAndForget(invalidateListChannels(owner), 'channel-list');
        },
      },
      callbacks
    ),
  }));
}
