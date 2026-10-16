import { debouncedDependent } from '@core/util/debounce';
import { throwOnErr } from '@core/util/result';
import type { MetaCompleteAuthorization } from '@service-storage/generated/schemas/metaCompleteAuthorization';
import type { MetaConversationView } from '@service-storage/generated/schemas/metaConversationView';
import type { MetaProvider } from '@service-storage/generated/schemas/metaProvider';
import type { MetaSendReply } from '@service-storage/generated/schemas/metaSendReply';
import { metaMessagingClient } from '@service-storage/meta-messaging';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { metaMessagingKeys } from './keys';
import { bindingRetryInterval, deliveryPollInterval } from './polling';

export function useMetaConfiguration() {
  return useQuery(() => ({
    queryKey: metaMessagingKeys.configuration.queryKey,
    queryFn: () => throwOnErr(() => metaMessagingClient.configuration()),
    staleTime: 60_000,
  }));
}

export function useMetaConnections(
  teamId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => connectionsQueryOptions(teamId(), enabled()));
}

function connectionsQueryOptions(teamId: string, enabled: boolean) {
  return queryOptions({
    queryKey: metaMessagingKeys.connections(teamId).queryKey,
    queryFn: () => throwOnErr(() => metaMessagingClient.connections()),
    enabled: enabled && !!teamId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.status !== 'error' &&
      query.state.data?.some((account) => account.status === 'connecting')
        ? 3_000
        : 30_000,
  });
}

export function useMetaConversation(
  channelId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => conversationQueryOptions(channelId(), enabled()));
}

function conversationQueryOptions(channelId: string, enabled: boolean) {
  return queryOptions({
    queryKey: metaMessagingKeys.conversation(channelId).queryKey,
    queryFn: async (): Promise<MetaConversationView | null> => {
      const result = await throwOnErr(() =>
        metaMessagingClient.conversation(channelId)
      );
      return result.messaging ?? null;
    },
    enabled: !!channelId && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    // Idle refresh catches account/window changes and messages from other teammates.
    refetchInterval: (query) => {
      const { data, status, errorUpdateCount } = query.state;
      if (data === undefined)
        return status === 'error'
          ? bindingRetryInterval(errorUpdateCount)
          : false;
      if (!data) return false;
      return status === 'error'
        ? 30_000
        : deliveryPollInterval(data.sends) || 30_000;
    },
  });
}

export function useMetaTemplates(
  channelId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => templatesQueryOptions(channelId(), enabled()));
}

function templatesQueryOptions(channelId: string, enabled: boolean) {
  return queryOptions({
    queryKey: metaMessagingKeys.templates(channelId).queryKey,
    queryFn: () => throwOnErr(() => metaMessagingClient.templates(channelId)),
    enabled,
    staleTime: 30_000,
  });
}

/** Fetch only visible history absent from the recent send feed. */
export function useMetaDelivery(
  channelId: Accessor<string>,
  messageIds: Accessor<string[]>
) {
  const fingerprint = () => `${channelId()}:${messageIds().join(',')}`;
  const settled = debouncedDependent(fingerprint, 150);
  return useQuery(() =>
    deliveryQueryOptions(channelId(), messageIds(), fingerprint() === settled())
  );
}

function deliveryQueryOptions(
  channelId: string,
  messageIds: string[],
  settled: boolean
) {
  return queryOptions({
    queryKey: metaMessagingKeys.delivery(channelId, messageIds).queryKey,
    queryFn: () =>
      throwOnErr(() => metaMessagingClient.delivery(channelId, messageIds)),
    enabled: !!channelId && messageIds.length > 0 && settled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.status === 'error'
        ? false
        : deliveryPollInterval(query.state.data ?? []),
  });
}

export function useMetaActions() {
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: metaMessagingKeys.connections._def,
      }),
      queryClient.invalidateQueries({
        queryKey: metaMessagingKeys.conversation._def,
      }),
    ]);
  };
  return {
    begin: useMutation(() => ({
      mutationFn: (args: { provider: MetaProvider; reconnectId?: string }) =>
        throwOnErr(() =>
          metaMessagingClient.begin(args.provider, args.reconnectId)
        ),
    })),
    complete: useMutation(() => ({
      mutationFn: (args: MetaCompleteAuthorization) =>
        throwOnErr(() => metaMessagingClient.complete(args)),
      onSuccess: refresh,
    })),
    developer: useMutation(() => ({
      mutationFn: () => throwOnErr(() => metaMessagingClient.developer()),
      onSuccess: refresh,
    })),
    disconnect: useMutation(() => ({
      mutationFn: (id: string) =>
        throwOnErr(() => metaMessagingClient.disconnect(id)),
      onSuccess: refresh,
    })),
  };
}

export function useMetaReply(channelId: Accessor<string>) {
  return useMutation(() => ({
    mutationFn: (request: MetaSendReply) =>
      throwOnErr(() => metaMessagingClient.reply(channelId(), request)),
    onSuccess: (send) => {
      const queryKey = metaMessagingKeys.conversation(send.channel_id).queryKey;
      queryClient.setQueryData<MetaConversationView | null>(
        queryKey,
        (account) =>
          account
            ? {
                ...account,
                sends: [
                  send,
                  ...account.sends.filter(
                    (existing) => existing.id !== send.id
                  ),
                ],
              }
            : account
      );
      // A refresh failure must not turn an accepted enqueue into a failed send.
      void refreshAcceptedReply(queryKey);
    },
  }));
}

/** Refresh presentation independently of an already accepted enqueue. */
async function refreshAcceptedReply(queryKey: readonly unknown[]) {
  try {
    await queryClient.invalidateQueries({ queryKey });
  } catch {
    // The conversation query exposes refresh failure; enqueue already succeeded.
  }
}

/** File staging is private; only the separate reply mutation can send it. */
export function useMetaUpload(channelId: Accessor<string>) {
  return useMutation(() => ({
    mutationFn: (file: File) =>
      throwOnErr(() => metaMessagingClient.upload(channelId(), file)),
  }));
}
