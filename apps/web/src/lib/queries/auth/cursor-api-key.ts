import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import type { CursorApiKeyStatus } from '@service-auth/generated/schemas';
import { useMutation, useQuery } from '@tanstack/solid-query';

import { authKeys } from './keys';

/**
 * Stable placeholder for `neverSuspend` consumers (see below). Reads as "no
 * key", so a surface that renders before the answer arrives hides `@cursor`
 * rather than offering one that cannot run.
 */
const NOT_CONNECTED: CursorApiKeyStatus = {
  registered: false,
  updatedAt: null,
};

/**
 * Whether the signed-in user has a Cursor API key stored.
 *
 * The response deliberately carries no part of the key, so this is only ever
 * enough to render "connected" or "not connected" — which is all the settings
 * surface needs.
 */
export function useCursorApiKeyStatusQuery(options?: {
  /**
   * Serve the placeholder instead of suspending on first load. For the message
   * composer, which decides whether to offer `@cursor` in the mention
   * typeahead: suspending there would block the input on a request that only
   * affects one optional entry.
   */
  neverSuspend?: boolean;
  /**
   * Skip the request entirely. The composer passes the `@cursor` feature flag,
   * so users without it never pay for a query whose answer they cannot use.
   */
  enabled?: boolean;
}) {
  return useQuery(() => ({
    queryKey: authKeys.cursorApiKeyStatus.queryKey,
    queryFn: async () =>
      throwOnErr(async () => await authServiceClient.getCursorApiKeyStatus()),
    enabled: options?.enabled ?? true,
    placeholderData: options?.neverSuspend ? NOT_CONNECTED : undefined,
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
