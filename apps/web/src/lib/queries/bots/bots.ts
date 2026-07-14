import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { channelKeys } from '../channel/keys';
import { botKeys } from './keys';

type CreateBotParams = {
  avatarUrl?: string;
  description?: string;
  handle: string;
  name: string;
  teamId?: string;
};

type CreateBotTokenParams = {
  botId: string;
  label?: string;
  expiresAt?: string;
};

type UpdateBotParams = Omit<CreateBotParams, 'teamId'> & {
  botId: string;
};

type DeleteBotParams = {
  botId: string;
  channelIds: string[];
};

export function useBotsQuery() {
  return useQuery(() => ({
    queryKey: botKeys.list.queryKey,
    queryFn: async (): Promise<Bot[]> =>
      await throwOnErr(() => storageServiceClient.getBots()),
  }));
}

export function useBotQuery(botId: () => string) {
  return useQuery(() => ({
    queryKey: botKeys.detail(botId()).queryKey,
    queryFn: async (): Promise<Bot> =>
      await throwOnErr(() => storageServiceClient.getBot({ bot_id: botId() })),
  }));
}

export function invalidateBots() {
  return queryClient.invalidateQueries({ queryKey: botKeys.list.queryKey });
}

export function useCreateBotMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: CreateBotParams) =>
      await throwOnErr(() =>
        storageServiceClient.createBot({
          avatar_url: vars.avatarUrl,
          description: vars.description,
          handle: vars.handle,
          name: vars.name,
          team_id: vars.teamId,
        })
      ),
    onSuccess: invalidateBots,
    onError: (error) => console.error('failed to create bot', error),
  }));
}

export function useUpdateBotMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: UpdateBotParams) =>
      await throwOnErr(() =>
        storageServiceClient.patchBot({
          bot_id: vars.botId,
          avatar_url: vars.avatarUrl,
          description: vars.description,
          handle: vars.handle,
          name: vars.name,
        })
      ),
    onSuccess: async (bot) => {
      queryClient.setQueryData(botKeys.detail(bot.id).queryKey, bot);
      await invalidateBots();
    },
    onError: (error) => console.error('failed to update bot', error),
  }));
}

export function useDeleteBotMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: DeleteBotParams) =>
      await throwOnErr(() =>
        storageServiceClient.deleteBot({ bot_id: vars.botId })
      ),
    onSuccess: async (_data, vars) => {
      queryClient.removeQueries({
        queryKey: botKeys.detail(vars.botId).queryKey,
      });
      queryClient.removeQueries({
        queryKey: botKeys.channels(vars.botId).queryKey,
      });
      queryClient.removeQueries({
        queryKey: botKeys.tokens(vars.botId).queryKey,
      });

      await Promise.all([
        invalidateBots(),
        ...vars.channelIds.flatMap((channelId) => [
          queryClient.invalidateQueries({
            queryKey: channelKeys.channelBots(channelId).queryKey,
          }),
          queryClient.invalidateQueries({
            queryKey: channelKeys.participants(channelId).queryKey,
          }),
        ]),
      ]);
    },
    onError: (error) => console.error('failed to delete bot', error),
  }));
}

export function useCreateBotTokenMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: CreateBotTokenParams) =>
      await throwOnErr(() =>
        storageServiceClient.createBotToken({
          bot_id: vars.botId,
          expires_at: vars.expiresAt,
          label: vars.label,
        })
      ),
    onSuccess: (_data, vars) =>
      queryClient.invalidateQueries({
        queryKey: botKeys.tokens(vars.botId).queryKey,
      }),
    onError: (error) => console.error('failed to create bot token', error),
  }));
}

export function useBotChannelsQuery(botId: () => string) {
  return useQuery(() => ({
    queryKey: botKeys.channels(botId()).queryKey,
    queryFn: async () =>
      await throwOnErr(() =>
        storageServiceClient.getBotChannels({ bot_id: botId() })
      ),
  }));
}

export function invalidateBotChannels(botId: string) {
  return queryClient.invalidateQueries({
    queryKey: botKeys.channels(botId).queryKey,
  });
}
