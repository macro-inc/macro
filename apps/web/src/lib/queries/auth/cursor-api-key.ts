import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import { useMutation, useQuery } from '@tanstack/solid-query';

import { authKeys } from './keys';

/**
 * Whether the signed-in user has a Cursor API key stored.
 *
 * The response deliberately carries no part of the key, so this is only ever
 * enough to render "connected" or "not connected" — which is all the settings
 * surface needs.
 */
export function useCursorApiKeyStatusQuery() {
  return useQuery(() => ({
    queryKey: authKeys.cursorApiKeyStatus.queryKey,
    queryFn: async () =>
      throwOnErr(async () => await authServiceClient.getCursorApiKeyStatus()),
  }));
}

/**
 * Stores a Cursor API key, replacing any existing one.
 *
 * Invalidates rather than writing the response into the cache: the mutation
 * returns the same shape the query does, but a user who pastes a key in two
 * tabs should see one truth, and the round trip is cheap.
 */
export function useSaveCursorApiKey() {
  return useMutation(() => ({
    mutationFn: async (apiKey: string) =>
      throwOnErr(async () => await authServiceClient.putCursorApiKey(apiKey)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: authKeys.cursorApiKeyStatus.queryKey,
      });
    },
  }));
}

/**
 * Forgets the stored Cursor API key.
 *
 * This does not revoke anything at Cursor; see the button's copy in
 * `CursorConnectionSection`.
 */
export function useDisconnectCursorApiKey() {
  return useMutation(() => ({
    mutationFn: async () =>
      throwOnErr(async () => await authServiceClient.deleteCursorApiKey()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: authKeys.cursorApiKeyStatus.queryKey,
      });
    },
  }));
}
