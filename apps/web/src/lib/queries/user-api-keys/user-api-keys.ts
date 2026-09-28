import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { CreatedUserApiKey } from '@service-storage/generated/schemas/createdUserApiKey';
import type { UserApiKeyInfo } from '@service-storage/generated/schemas/userApiKeyInfo';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { userApiKeyKeys } from './keys';
import { normalizeUserApiKeyName } from './name';

export function useUserApiKeysQuery() {
  return useQuery(() => ({
    queryKey: userApiKeyKeys.list.queryKey,
    queryFn: async (): Promise<UserApiKeyInfo[]> =>
      await throwOnErr(() => storageServiceClient.listUserApiKeys()),
  }));
}

export function invalidateUserApiKeys() {
  return queryClient.invalidateQueries({
    queryKey: userApiKeyKeys.list.queryKey,
  });
}

export function useCreateUserApiKeyMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: { name: string }): Promise<CreatedUserApiKey> => {
      const normalized = normalizeUserApiKeyName(vars.name);
      if (!normalized.ok) {
        throw new Error(normalized.error);
      }
      return await throwOnErr(() =>
        storageServiceClient.createUserApiKey({ name: normalized.name })
      );
    },
    onSuccess: invalidateUserApiKeys,
    onError: (error) => console.error('failed to create user api key', error),
  }));
}

export function useDeleteUserApiKeyMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: { id: string }) =>
      await throwOnErr(() => storageServiceClient.deleteUserApiKey(vars)),
    onSuccess: invalidateUserApiKeys,
    onError: (error) => console.error('failed to delete user api key', error),
  }));
}
