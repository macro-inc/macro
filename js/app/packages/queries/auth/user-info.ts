import { catchToResult, throwOnErr } from '@core/util/maybeResult';
import { hasLoginCookie } from '@core/util/cookies';
import { enableUserInfoQuery } from '@core/context/user-info-gate';
import { authServiceClient } from '@service-auth/client';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { authKeys } from './keys';

export { authKeys } from './keys';

const USER_INFO_STALE_TIME = 15_000; // 15 seconds

export type UserInfoData = Awaited<
  ReturnType<typeof authServiceClient.getLegacyUserPermissions>
>[1];

type UseUserInfoQueryOptions = {
  /** Whether the query should be enabled. Can be a boolean or accessor for reactivity. */
  enabled?: boolean | (() => boolean);
};

/** Query for the current user's info and permissions. */
export function useUserInfoQuery(options?: UseUserInfoQueryOptions) {
  return useQuery(() => {
    const enabled =
      typeof options?.enabled === 'function'
        ? options.enabled()
        : (options?.enabled ?? true);
    return {
      queryKey: authKeys.userInfo.queryKey,
      queryFn: async () =>
        await throwOnErr(
          async () => await authServiceClient.getLegacyUserPermissions()
        ),
      throwOnError: false,
      staleTime: USER_INFO_STALE_TIME,
      enabled,
    };
  });
}

/** Invalidate the user info query to trigger a refetch. */
export function invalidateUserInfo() {
  // Enable the query in case it was disabled (e.g., during unauthenticated flows)
  enableUserInfoQuery();

  // Always invalidate — the query may be in error state (no cached data)
  // from pre-auth requests, and needs to be explicitly refetched.
  return queryClient.invalidateQueries({
    queryKey: authKeys.userInfo.queryKey,
  });
}

/**
 * Invalidate all queries after a successful login.
 *
 * Global providers (channels, notifications, quick access, etc.) mount before
 * auth is established and their queries fail with 401. Since
 * `refetchOnWindowFocus` is disabled and retries are limited, these queries
 * stay in error state permanently unless explicitly invalidated.
 */
export function invalidateAllAfterLogin() {
  enableUserInfoQuery();

  // Flush every query in the cache — any that failed pre-auth will refetch
  // with the now-valid session cookies.
  return queryClient.invalidateQueries();
}

/** Ensure user info is in the query cache. Fetches if not present. */
export async function prefetchUserInfo() {
  // Skip prefetch if user doesn't appear to be authenticated.
  // This prevents unnecessary auth requests during unauthenticated flows.
  if (!hasLoginCookie()) return;

  await catchToResult(
    async () =>
      await queryClient.ensureQueryData({
        queryKey: authKeys.userInfo.queryKey,
        queryFn: async () =>
          await throwOnErr(
            async () => await authServiceClient.getLegacyUserPermissions()
          ),
      })
  );
}

/** Fetch user info and return the data. Use when you need the result. */
export async function fetchUserInfo() {
  return queryClient.fetchQuery({
    queryKey: authKeys.userInfo.queryKey,
    queryFn: async () =>
      await throwOnErr(
        async () => await authServiceClient.getLegacyUserPermissions()
      ),
  });
}

/**
 * @deprecated Use invalidateUserInfo() instead
 */
export const updateUserInfo = invalidateUserInfo;
