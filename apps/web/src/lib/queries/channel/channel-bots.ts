import { throwOnErr } from '@core/util/result';
import { invalidateBotChannels, invalidateBots } from '@queries/bots/bots';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { Bot } from '@service-storage/generated/schemas/bot';
import type { CreateChannelScopedBotRequest } from '@service-storage/generated/schemas/createChannelScopedBotRequest';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { channelKeys } from './keys';

type AddBotToChannelParams = {
  channelId: string;
  botId: string;
};

type AddBotToChannelsParams = {
  channelIds: string[];
  botId: string;
};

type SyncBotChannelsParams = {
  botId: string;
  currentChannelIds: string[];
  nextChannelIds: string[];
};

type CreateChannelScopedBotParams = CreateChannelScopedBotRequest & {
  channelId: string;
};

export function useChannelBotsQuery(channelId: () => string) {
  return useQuery(() => ({
    queryKey: channelKeys.channelBots(channelId()).queryKey,
    queryFn: async (): Promise<Bot[]> =>
      await throwOnErr(() =>
        storageServiceClient.getChannelBots({
          channel_id: channelId(),
        })
      ),
  }));
}

function invalidateChannelBots(channelId: string) {
  return queryClient.invalidateQueries({
    queryKey: channelKeys.channelBots(channelId).queryKey,
  });
}

export function useAddBotToChannelMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: AddBotToChannelParams) =>
      await throwOnErr(() =>
        storageServiceClient.addBotToChannel({
          channel_id: vars.channelId,
          bot_id: vars.botId,
        })
      ),
    onSuccess: (_data, vars) =>
      invalidateBotChannelViews(vars.botId, [vars.channelId]),
    onError: (error) => console.error('failed to add bot to channel', error),
  }));
}

async function invalidateBotChannelViews(botId: string, channelIds: string[]) {
  await Promise.all([
    invalidateBotChannels(botId),
    ...[...new Set(channelIds)].flatMap((channelId) => [
      invalidateChannelBots(channelId),
      queryClient.invalidateQueries({
        queryKey: channelKeys.participants(channelId).queryKey,
      }),
    ]),
  ]);
}

export function useAddBotToChannelsMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: AddBotToChannelsParams) => {
      const results = await Promise.allSettled(
        vars.channelIds.map((channelId) =>
          throwOnErr(() =>
            storageServiceClient.addBotToChannel({
              channel_id: channelId,
              bot_id: vars.botId,
            })
          ).then(() => channelId)
        )
      );
      return {
        addedChannelIds: results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        ),
        failedCount: results.filter((result) => result.status === 'rejected')
          .length,
      };
    },
    onSuccess: (_data, vars) =>
      invalidateBotChannelViews(vars.botId, vars.channelIds),
    onError: (error) => console.error('failed to add bot to channels', error),
  }));
}

export function useSyncBotChannelsMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: SyncBotChannelsParams) => {
      const current = new Set(vars.currentChannelIds);
      const next = new Set(vars.nextChannelIds);
      const additions = vars.nextChannelIds.filter((id) => !current.has(id));
      const removals = vars.currentChannelIds.filter((id) => !next.has(id));
      const results = await Promise.allSettled([
        ...additions.map((channelId) =>
          throwOnErr(() =>
            storageServiceClient.addBotToChannel({
              channel_id: channelId,
              bot_id: vars.botId,
            })
          )
        ),
        ...removals.map((channelId) =>
          throwOnErr(() =>
            storageServiceClient.removeBotFromChannel({
              channel_id: channelId,
              bot_id: vars.botId,
            })
          )
        ),
      ]);
      return {
        failedCount: results.filter((result) => result.status === 'rejected')
          .length,
      };
    },
    onSuccess: (_data, vars) =>
      invalidateBotChannelViews(vars.botId, [
        ...vars.currentChannelIds,
        ...vars.nextChannelIds,
      ]),
    onError: (error) => console.error('failed to sync bot channels', error),
  }));
}

export function useRemoveBotFromChannelMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: AddBotToChannelParams) =>
      await throwOnErr(() =>
        storageServiceClient.removeBotFromChannel({
          channel_id: vars.channelId,
          bot_id: vars.botId,
        })
      ),
    onSuccess: (_data, vars) =>
      invalidateBotChannelViews(vars.botId, [vars.channelId]),
    onError: (error) =>
      console.error('failed to remove bot from channel', error),
  }));
}

export function useCreateChannelScopedBotMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: CreateChannelScopedBotParams) => {
      const { channelId, ...request } = vars;
      return await throwOnErr(() =>
        storageServiceClient.createChannelScopedBot({
          ...request,
          channel_id: channelId,
        })
      );
    },
    onSuccess: async (data, vars) => {
      await Promise.all([
        invalidateBots(),
        invalidateBotChannelViews(data.bot.id, [vars.channelId]),
      ]);
    },
    onError: (error) =>
      console.error('failed to create channel-scoped bot', error),
  }));
}
