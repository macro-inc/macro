import {
  bindSessionIdentity,
  deriveIsAuthenticated,
  identityFromAuthenticated,
  markSessionConfirmed,
} from '@core/auth/session';
import { shouldQueryUserInfo } from '@core/context/user-info-gate';
import {
  initializeNativeNetworkStatus,
  subscribeNativeNetworkStatus,
} from '@core/mobile/native-network-status';
import { isPlatform } from '@core/util/platform';
import { thrownResultErrorHasCode } from '@core/util/result';
import { hashKey, onlineManager } from '@tanstack/query-core';
import { authKeys } from './auth/keys';
import type { UserInfoData } from './auth/user-info';
import { setupQueryPersistence } from './persistence';
import { createQueryPersistenceScopes } from './persistence-scopes';
import { SESSION_ONLY_QUERY_KEYS } from './session-families';
import { SessionGatedQueryClient } from './session-gate';
import { initSoupNormalizer } from './soup/normalized-cache/normalizer';

export const queryClient = new SessionGatedQueryClient({
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

queryClient.requireSessionFor(SESSION_ONLY_QUERY_KEYS);

const userInfoHash = hashKey(authKeys.userInfo.queryKey);

bindSessionIdentity(
  () => {
    // Read the cache by hash: `getQueryState` runs `defaultQueryOptions`,
    // which reads the session, which would recurse back here.
    const state = queryClient
      .getQueryCache()
      .get<UserInfoData>(userInfoHash)?.state;
    return identityFromAuthenticated(
      deriveIsAuthenticated({
        isLoading: shouldQueryUserInfo() && state?.status !== 'success',
        isError: state?.status === 'error',
        error: state?.error,
        data: state?.data,
      })
    );
  },
  (onChange) =>
    queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryHash !== userInfoHash) return;
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        !event.action.manual &&
        event.query.state.data?.authenticated
      ) {
        markSessionConfirmed();
      }
      onChange();
    })
);

if (isPlatform(['ios', 'android'])) {
  // Use the native default network path on both mobile platforms.
  onlineManager.setEventListener((setOnline) =>
    subscribeNativeNetworkStatus((status) => {
      if (status !== 'unknown') setOnline(status === 'online');
    })
  );
  void initializeNativeNetworkStatus();
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
