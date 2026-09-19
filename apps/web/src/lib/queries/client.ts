import {
  initializeNativeNetworkStatus,
  subscribeNativeNetworkStatus,
} from '@core/mobile/native-network-status';
import { isPlatform } from '@core/util/platform';
import { thrownResultErrorHasCode } from '@core/util/result';
import { onlineManager } from '@tanstack/query-core';
import { QueryClient } from '@tanstack/solid-query';
import { setupQueryPersistence } from './persistence';
import { createQueryPersistenceScopes } from './persistence-scopes';
import { initSoupNormalizer } from './soup/cache';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
      refetchOnWindowFocus: false,
      // Auth failures are terminal within a session — fetchWithToken already
      // refreshes and retries the token internally, so a query-level retry just
      // repeats the doomed request.
      retry: (failureCount, error) => {
        if (
          thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
          thrownResultErrorHasCode(error, 'FORBIDDEN')
        ) {
          return false;
        }
        return failureCount < 1;
      },
    },
  },
});

if (isPlatform('ios')) {
  // Replace WKWebView's navigator.onLine integration with NWPathMonitor.
  onlineManager.setEventListener((setOnline) =>
    subscribeNativeNetworkStatus((status) => {
      if (status !== 'unknown') setOnline(status === 'online');
    })
  );
  void initializeNativeNetworkStatus();
}

const buster = import.meta.env.__APP_VERSION__ ?? 'dev';

setupQueryPersistence({
  queryClient,
  scopes: createQueryPersistenceScopes(buster),
});

// Subscribe to query cache events for automatic normalization of soup entities
initSoupNormalizer(queryClient);

export function useQueryClient() {
  return queryClient;
}
