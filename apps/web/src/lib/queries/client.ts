import {
  initializeNativeNetworkStatus,
  subscribeNativeNetworkStatus,
} from '@core/mobile/native-network-status';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import { onlineManager } from '@tanstack/query-core';
import { QueryClient } from '@tanstack/solid-query';
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

export const queryPersistence = setupQueryPersistence({
  queryClient,
  scopes: createQueryPersistenceScopes(buster),
});

// Subscribe to query cache events for automatic normalization of soup entities
initSoupNormalizer(queryClient);

export function useQueryClient() {
  return queryClient;
}
