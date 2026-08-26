import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { Persona } from '@service-storage/generated/schemas/persona';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { botKeys } from './keys';

type CreatePersonaParams = {
  name: string;
  handle: string;
  description?: string;
  avatarUrl?: string;
  systemPrompt?: string;
};

type UpdatePersonaParams = {
  personaId: string;
  name?: string;
  handle?: string;
  /** `null` clears the field; `undefined` leaves it unchanged. */
  description?: string | null;
  avatarUrl?: string | null;
  systemPrompt?: string | null;
};

/**
 * The current user's personas (shown to them as "agents").
 *
 * User-scoped rather than per-channel — a persona is mentionable by its owner
 * everywhere, so this is cached once for the app rather than once per channel
 * like `useChannelBotsQuery`.
 */
export function usePersonasQuery() {
  return useQuery(() => ({
    queryKey: botKeys.personas.queryKey,
    queryFn: async (): Promise<Persona[]> =>
      await throwOnErr(() => storageServiceClient.getPersonas()),
  }));
}

export function usePersonaQuery(personaId: () => string) {
  return useQuery(() => ({
    queryKey: botKeys.persona(personaId()).queryKey,
    queryFn: async (): Promise<Persona> =>
      await throwOnErr(() =>
        storageServiceClient.getPersona({ persona_id: personaId() })
      ),
  }));
}

/** Editing a persona changes what the mention menu shows, so the list goes. */
async function invalidatePersonas(personaId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: botKeys.personas.queryKey }),
    ...(personaId
      ? [
          queryClient.invalidateQueries({
            queryKey: botKeys.persona(personaId).queryKey,
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
          name: vars.name,
          handle: vars.handle,
          description: vars.description ?? null,
          avatar_url: vars.avatarUrl ?? null,
          system_prompt: vars.systemPrompt ?? null,
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
          persona_id: vars.personaId,
          name: vars.name,
          handle: vars.handle,
          description: vars.description,
          avatar_url: vars.avatarUrl,
          system_prompt: vars.systemPrompt,
        })
      ),
    onSuccess: async (_data, vars) => await invalidatePersonas(vars.personaId),
    onError: (error) => console.error('failed to update persona', error),
  }));
}

export function useDeletePersonaMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: { personaId: string }) =>
      await throwOnErr(() =>
        storageServiceClient.deletePersona({ persona_id: vars.personaId })
      ),
    onSuccess: async (_data, vars) => {
      queryClient.removeQueries({
        queryKey: botKeys.persona(vars.personaId).queryKey,
      });
      await invalidatePersonas();
    },
    onError: (error) => console.error('failed to delete persona', error),
  }));
}
