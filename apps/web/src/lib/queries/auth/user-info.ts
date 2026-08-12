import { syncPushRegistrations } from '@core/auth/push-registration-lifecycle';
import { enableUserInfoQuery } from '@core/context/user-info-gate';
import { hasLoginCookie } from '@core/util/cookies';
import { catchToResult, type ResultType, throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { authKeys } from './keys';

export { authKeys } from './keys';

const USER_INFO_STALE_TIME = 15_000; // 15 seconds

export type UserInfoData = ResultType<
  Awaited<ReturnType<typeof authServiceClient.getLegacyUserPermissions>>
>;

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
      // Never pause on navigator.onLine — it reports false during native cold
      // launches (e.g. woken by a notification tap) while the network is fine,
      // and a paused auth check renders as "unauthenticated" at the base path.
      networkMode: 'always',
      enabled,
    };
  });
}

/** Invalidate the user info query to trigger a refetch. */
export function invalidateUserInfo() {
  enableUserInfoQuery();
  return queryClient.invalidateQueries({
    queryKey: authKeys.userInfo.queryKey,
  });
}

/** Invalidate all queries after a successful login. */
export function invalidateAllAfterLogin() {
  enableUserInfoQuery();
  const invalidated = queryClient.invalidateQueries();
  // Rebind this device's push registrations once the refetches above have
  // exercised the fresh session — registering earlier can race auth state
  // that is still settling. Fire-and-forget so login isn't blocked on the
  // notification service.
  void invalidated.catch(() => {}).then(() => syncPushRegistrations());
  return invalidated;
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
        networkMode: 'always',
      })
  );
}

/** Fetch user info and return the data. Use when you need the result. */
async function _fetchUserInfo() {
  return queryClient.fetchQuery({
    queryKey: authKeys.userInfo.queryKey,
    queryFn: async () =>
      await throwOnErr(
        async () => await authServiceClient.getLegacyUserPermissions()
      ),
    networkMode: 'always',
  });
}

/**
 * @deprecated Use invalidateUserInfo() instead
 */
const _updateUserInfo = invalidateUserInfo;
