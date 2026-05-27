import { throwOnErr } from '@core/util/result';
import { dssFetch } from '@service-storage/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { queryClient } from './client';

export type BotOwner =
  | { type: 'user'; user_id: string }
  | { type: 'team'; team_id: string };

export type Bot = {
  id: string;
  kind: 'owned' | 'system';
  owner?: BotOwner | null;
  name: string;
  handle: string;
  description?: string | null;
  avatar_url?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type BotToken = {
  id: string;
  bot_id: string;
  token_prefix: string;
  label?: string | null;
  last_used_at?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
};

export type CreateBotInput = {
  team_id?: string | null;
  name: string;
  handle: string;
  description?: string | null;
  avatar_url?: string | null;
};

export type PatchBotInput = {
  botId: string;
  name?: string;
  handle?: string;
  description?: string | null;
  avatar_url?: string | null;
};

export type CreateBotTokenInput = {
  botId: string;
  label?: string | null;
  expires_at?: string | null;
};

export type CreateBotTokenResponse = {
  token: BotToken;
  bearer_token: string;
};

export const botKeys = {
  all: ['bots'] as const,
};

function invalidateBots() {
  queryClient.invalidateQueries({ queryKey: botKeys.all });
}

export function useBotsQuery() {
  return useQuery(() => ({
    queryKey: botKeys.all,
    queryFn: async (): Promise<Bot[]> =>
      await throwOnErr(async () => {
        return await dssFetch<Bot[]>('/bots', { method: 'GET' });
      }),
  }));
}

export function useCreateBotMutation() {
  return useMutation(() => ({
    mutationFn: async (vars: CreateBotInput): Promise<Bot> =>
      await throwOnErr(async () => {
        return await dssFetch<Bot>('/bots', {
          method: 'POST',
          body: JSON.stringify(vars),
        });
      }),
    onSuccess: invalidateBots,
  }));
}

export function usePatchBotMutation() {
  return useMutation(() => ({
    mutationFn: async (vars: PatchBotInput): Promise<Bot> =>
      await throwOnErr(async () => {
        const { botId, ...body } = vars;
        return await dssFetch<Bot>(`/bots/${botId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }),
    onSuccess: invalidateBots,
  }));
}

export function useDeleteBotMutation() {
  return useMutation(() => ({
    mutationFn: async (vars: { botId: string }) =>
      await throwOnErr(async () => {
        return await dssFetch(`/bots/${vars.botId}`, { method: 'DELETE' });
      }),
    onSuccess: invalidateBots,
  }));
}

export function useCreateBotTokenMutation() {
  return useMutation(() => ({
    mutationFn: async (
      vars: CreateBotTokenInput
    ): Promise<CreateBotTokenResponse> =>
      await throwOnErr(async () => {
        const { botId, ...body } = vars;
        return await dssFetch<CreateBotTokenResponse>(`/bots/${botId}/tokens`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }),
  }));
}

export function useRevokeBotTokenMutation() {
  return useMutation(() => ({
    mutationFn: async (vars: { botId: string; tokenId: string }) =>
      await throwOnErr(async () => {
        return await dssFetch(`/bots/${vars.botId}/tokens/${vars.tokenId}`, {
          method: 'DELETE',
        });
      }),
  }));
}
