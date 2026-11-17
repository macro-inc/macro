import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { queryOptions } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { authKeys } from './keys';

/**
 * The signed-in user's web feature flags as the backend evaluates them: the
 * fallback when PostHog's own flag request fails. The flag store reads it at
 * most once per account change and keeps the answer itself, so nothing is
 * cached here: each read asks the backend again.
 */
export function webFeatureFlagsQueryOptions(userId: string) {
  return queryOptions({
    queryKey: authKeys.webFeatureFlags(userId).queryKey,
    queryFn: async () =>
      (await throwOnErr(() => authServiceClient.getWebFeatureFlags())).flags,
    staleTime: 0,
    gcTime: 0,
    // A retry would send whichever session is current by then, possibly
    // another account's; the flag store falls back further instead.
    retry: false,
  });
}

/** Drops a read still in flight when the signed-in account changes. */
export function cancelWebFeatureFlags(): void {
  queryClient.cancelQueries({ queryKey: authKeys.webFeatureFlags._def });
}

/** Reads the account's web feature flags from the backend. */
export function fetchWebFeatureFlags(userId: string) {
  return queryClient.fetchQuery(webFeatureFlagsQueryOptions(userId));
}
