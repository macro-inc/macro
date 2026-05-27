import { throwOnErr } from '@core/util/result';
import { dssFetch } from '@service-storage/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { Bot } from './bots';
import { channelKeys } from './channel/keys';
import { queryClient } from './client';

function invalidateChannelBots(channelId: string) {
  queryClient.invalidateQueries({
    queryKey: channelKeys.bots(channelId).queryKey,
  });
}

export function useChannelBotsQuery(channelId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: channelKeys.bots(channelId()).queryKey,
    queryFn: async (): Promise<Bot[]> =>
      await throwOnErr(async () => {
        return await dssFetch<Bot[]>(`/channels/${channelId()}/bots`, {
          method: 'GET',
        });
      }),
  }));
}

export function useAddChannelBotMutation() {
  return useMutation(() => ({
    mutationFn: async (vars: { channelId: string; botId: string }) =>
      await throwOnErr(async () => {
        return await dssFetch(`/channels/${vars.channelId}/bots`, {
          method: 'POST',
          body: JSON.stringify({ bot_id: vars.botId }),
        });
      }),
    onSuccess: (_, vars) => {
      invalidateChannelBots(vars.channelId);
    },
  }));
}

export function useRemoveChannelBotMutation() {
  return useMutation(() => ({
    mutationFn: async (vars: { channelId: string; botId: string }) =>
      await throwOnErr(async () => {
        return await dssFetch(
          `/channels/${vars.channelId}/bots/${vars.botId}`,
          {
            method: 'DELETE',
          }
        );
      }),
    onSuccess: (_, vars) => {
      invalidateChannelBots(vars.channelId);
    },
  }));
}
