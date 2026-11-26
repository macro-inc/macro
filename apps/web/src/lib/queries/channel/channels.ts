import { analytics } from '@app/lib/analytics';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/index';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  type MessageResponse,
  storageServiceClient,
} from '@service-storage/client';
import type { CreateChannelRequest } from '@service-storage/generated/schemas/createChannelRequest';
import type { CreateChannelResponse } from '@service-storage/generated/schemas/createChannelResponse';
import type { PatchChannelRequest } from '@service-storage/generated/schemas/patchChannelRequest';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  assertQueryAccount,
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
import { refreshChannelDirectory } from './directory';
import {
  type CachedGraphqlChannel,
  readCachedGraphqlChannels,
} from './graphql';
import { channelKeys } from './keys';

// Resolved account/generation inputs, not component accessors, are retained.
export function cachedGraphqlChannelsQueryOptions(
  cacheHost: CacheHost | undefined,
  account: QueryAccount | undefined,
  generation: number
) {
  return {
    queryKey: channelKeys.quickAccessGraphql(
      cacheHost?.clientId ?? 'disabled',
      account?.userId,
      generation
    ).queryKey,
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<CachedGraphqlChannel[]> => {
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
  };
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

/**
 * Create a channel. Refreshes the in-memory channel directory on settle.
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
        onSettled: (data, _error, _variables, _result, context) => {
          if (isCurrentQueryAccount(mutationQueryAccount(context)))
            fireAndForget(
              refreshChannelDirectory(data ? [data.id] : []),
              'channel-list'
            );
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
          if (!isCurrentQueryAccount(mutationQueryAccount(context))) return;
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
        onSettled: (_data, _error, variables, _result, context) => {
          if (isCurrentQueryAccount(mutationQueryAccount(context)))
            fireAndForget(
              refreshChannelDirectory([variables.channelId]),
              'channel-list'
            );
        },
      },
      callbacks
    ),
  }));
}
