import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { queryOptions } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { authKeys } from './keys';

/**
 * The signed-in user's web feature flags as the backend evaluates them: the
 * fallback when PostHog's own flag request fails. One read per account per
 * page load; PostHog stays the source that refreshes.
 */
export function webFeatureFlagsQueryOptions(userId: string) {
  return queryOptions({
    queryKey: authKeys.webFeatureFlags(userId).queryKey,
    queryFn: async () =>
      (await throwOnErr(() => authServiceClient.getWebFeatureFlags())).flags,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
}

/** Reads the account's web feature flags once per page load. */
export function fetchWebFeatureFlags(userId: string) {
  return queryClient.fetchQuery(webFeatureFlagsQueryOptions(userId));
}
