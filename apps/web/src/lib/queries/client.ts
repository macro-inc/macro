import {
  initializeNativeNetworkStatus,
  subscribeNativeNetworkStatus,
} from '@core/mobile/native-network-status';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import { startupAuthorityHint } from '@graphql-cache/generation-mirror';
import { crmAccessAuthority } from '@service-storage/crm-access-authority';
import {
  onlineManager,
  partialMatchKey,
  type QueryKey,
} from '@tanstack/query-core';
import { QueryClient } from '@tanstack/solid-query';
import { untrack } from 'solid-js';
import { authKeys } from './auth/keys';
import { traceQueriesToFlows } from './flow-trace';
import { setupQueryPersistence } from './persistence';
import { createQueryPersistenceScopes } from './persistence-scopes';
import { defaultQueryRetry } from './retry';
import { initSoupNormalizer } from './soup/normalized-cache/normalizer';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
      refetchOnWindowFocus: false,
      retry: defaultQueryRetry,
    },
  },
});

traceQueriesToFlows(queryClient);

if (isPlatform(['ios', 'android'])) {
  // Use the native default network path on both mobile platforms.
  onlineManager.setEventListener((setOnline) =>
    subscribeNativeNetworkStatus((status) => {
      if (status !== 'unknown') setOnline(status === 'online');
    })
  );
  fireAndForget(initializeNativeNetworkStatus(), 'native-network-status');
}

const buster = import.meta.env.__APP_VERSION__ ?? 'dev';

/**
 * While CRM access is denied, any query family can hold what was fetched before
 * the denial, and another window can still write its copy after this profile
 * was pruned. So nothing but the identity a native app relaunches on is
 * restored or saved. While this page has no recorded policy, the denial it
 * started under counts.
 */
function crmDenialClosesPersistence(key: QueryKey): boolean {
  if (partialMatchKey(key, authKeys.userInfo.queryKey)) return false;
  // Cache events run inside the computation that caused them. Reading the
  // access state there must not subscribe that computation to it.
  if (untrack(crmAccessAuthority.state) === 'denied') return true;
  const policy =
    crmAccessAuthority.snapshot()?.policy ?? startupAuthorityHint?.policy;
  return policy?.endsWith(':denied') === true;
}

export const queryPersistence = setupQueryPersistence({
  queryClient,
  scopes: createQueryPersistenceScopes(buster),
  exclude: crmDenialClosesPersistence,
});

// Subscribe to query cache events for automatic normalization of soup entities
initSoupNormalizer(queryClient);

export function useQueryClient() {
  return queryClient;
}
