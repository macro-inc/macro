import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { AgentConfig } from '@service-storage/generated/schemas/agentConfig';
import type { MentionableBot } from '@service-storage/generated/schemas/mentionableBot';
import type { Persona } from '@service-storage/generated/schemas/persona';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { botKeys } from './keys';

type CreatePersonaParams = {
  teamId: string;
  name: string;
  handle: string;
  description?: string;
  avatarUrl?: string;
  agent: AgentConfig;
};

type UpdatePersonaParams = {
  botId: string;
  name?: string;
  handle?: string;
  description?: string;
  avatarUrl?: string;
  agent?: AgentConfig;
};

/**
 * Every bot the current user may `@`-mention: the ownerless first-party ones
 * plus their teams' personas.
 *
 * Team-scoped rather than per-channel — a persona is mentionable everywhere,
 * so this is cached once for the app rather than once per channel like
 * `useChannelBotsQuery`.
 */
export function useMentionableBotsQuery() {
  return useQuery(() => ({
    queryKey: botKeys.mentionable.queryKey,
    queryFn: async (): Promise<MentionableBot[]> =>
      await throwOnErr(() => storageServiceClient.getMentionableBots()),
  }));
}

export function usePersonasQuery() {
  return useQuery(() => ({
    queryKey: botKeys.personas.queryKey,
    queryFn: async (): Promise<Persona[]> =>
      await throwOnErr(() => storageServiceClient.getPersonas()),
  }));
}

export function usePersonaQuery(botId: () => string) {
  return useQuery(() => ({
    queryKey: botKeys.persona(botId()).queryKey,
    queryFn: async (): Promise<Persona> =>
      await throwOnErr(() =>
        storageServiceClient.getPersona({ bot_id: botId() })
      ),
  }));
}

/** Editing a persona changes what the mention menu shows, so both lists go. */
async function invalidatePersonas(botId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: botKeys.personas.queryKey }),
    queryClient.invalidateQueries({ queryKey: botKeys.mentionable.queryKey }),
    ...(botId
      ? [
          queryClient.invalidateQueries({
            queryKey: botKeys.persona(botId).queryKey,
          }),
        ]
      : []),
  ]);
}

export function useCreatePersonaMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: CreatePersonaParams) =>
      await throwOnErr(() =>
        storageServiceClient.createPersona({
          team_id: vars.teamId,
          name: vars.name,
          handle: vars.handle,
          description: vars.description ?? null,
          avatar_url: vars.avatarUrl ?? null,
          agent: vars.agent,
        })
      ),
    onSuccess: async () => await invalidatePersonas(),
    onError: (error) => console.error('failed to create persona', error),
  }));
}

export function useUpdatePersonaMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: UpdatePersonaParams) =>
      await throwOnErr(() =>
        storageServiceClient.patchPersona({
          bot_id: vars.botId,
          name: vars.name,
          handle: vars.handle,
          description: vars.description,
          avatar_url: vars.avatarUrl,
          agent: vars.agent,
        })
      ),
    onSuccess: async (_data, vars) => await invalidatePersonas(vars.botId),
    onError: (error) => console.error('failed to update persona', error),
  }));
}

export function useDeletePersonaMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: { botId: string }) =>
      await throwOnErr(() =>
        storageServiceClient.deletePersona({ bot_id: vars.botId })
      ),
    onSuccess: async (_data, vars) => {
      queryClient.removeQueries({
        queryKey: botKeys.persona(vars.botId).queryKey,
      });
      await invalidatePersonas();
    },
    onError: (error) => console.error('failed to delete persona', error),
  }));
}
