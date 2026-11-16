import { syncPushRegistrations } from '@core/auth/push-registration-lifecycle';
import { toast } from '@core/component/Toast/Toast';
import {
  enableUserInfoQuery,
  shouldQueryUserInfo,
} from '@core/context/user-info-gate';
import { hasLoginCookie } from '@core/util/cookies';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  catchToResult,
  type ResultType,
  thrownResultErrorHasCode,
  throwOnErr,
} from '@core/util/result';
import { replaceCacheWriteSession } from '@graphql-cache/lifecycle';
import { Telemetry } from '@macro-inc/observability';
import { authServiceClient } from '@service-auth/client';
import { resetGraphqlPresenceRequests } from '@service-storage/graphql-soup';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import { resetTeamCalendarSession } from '../calendar/team-cache';
import { queryClient, queryPersistence } from '../client';
import { resetGraphqlSoupDoneSession } from '../soup/graphql/done-session';
import {
  queryAccountSessionPending,
  resetQueryAccountSession,
} from './account-scope';
import { authKeys } from './keys';
import { hasCachedUserIdentity } from './user-info-cache';

export { authKeys } from './keys';

const USER_INFO_STALE_TIME = 15_000; // 15 seconds

export type UserInfoData = ResultType<
  Awaited<ReturnType<typeof authServiceClient.getLegacyUserPermissions>>
>;

type UseUserInfoQueryOptions = {
  /** Whether the query should be enabled. Can be a boolean or accessor for reactivity. */
  enabled?: boolean | (() => boolean);
};

function fetchLegacyUserPermissions() {
  return throwOnErr(() => authServiceClient.getLegacyUserPermissions());
}

function identityRefreshIsTerminal(): boolean {
  const error = queryClient.getQueryState(authKeys.userInfo.queryKey)?.error;
  return (
    thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
    thrownResultErrorHasCode(error, 'FORBIDDEN')
  );
}

// Cached callbacks stay at module scope so they never retain the caller.
function userInfoQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: authKeys.userInfo.queryKey,
    queryFn: fetchLegacyUserPermissions,
    throwOnError: false,
    staleTime: USER_INFO_STALE_TIME,
    // Signed-out screens also observe this query. Retrying their cached 401
    // on mount resets auth to loading, unmounts them, and repeats forever.
    // Successful login explicitly invalidates the query to refresh identity.
    retryOnMount: false,
    // Never pause on navigator.onLine — it reports false during native cold
    // launches (e.g. woken by a notification tap) while the network is fine,
    // and a paused auth check renders as "unauthenticated" at the base path.
    networkMode: 'always',
    refetchOnReconnect: true,
    // Recover a failed post-login identity refresh while the account gate is
    // pending. Terminal auth failures remain the session-expiry path.
    refetchInterval: () =>
      queryAccountSessionPending() && !identityRefreshIsTerminal()
        ? 5_000
        : false,
    enabled,
  });
}

/** Query for the current user's info and permissions. */
export function useUserInfoQuery(options?: UseUserInfoQueryOptions) {
  return useQuery(() =>
    userInfoQueryOptions(
      typeof options?.enabled === 'function'
        ? options.enabled()
        : (options?.enabled ?? shouldQueryUserInfo())
    )
  );
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
  return Telemetry.anonymousSpan('auth.refresh_after_login', async (span) => {
    const cacheSession = replaceCacheWriteSession();
    try {
      // Login may replace a session without visiting logout (including native auth).
      // Invalidate old display-intent handles before refetching the new identity.
      resetGraphqlSoupDoneSession();
      resetGraphqlPresenceRequests();
      resetTeamCalendarSession();
      await span.span('auth.reset_account_sources', resetQueryAccountSession);
      const invalidated = cacheSession.ready
        .catch((error: unknown) => {
          toast.failure('Sign-in could not finish', {
            subtext:
              'Local storage cleanup failed. Your queued changes are preserved. Try signing in again.',
          });
          throw error;
        })
        .then(() => {
          if (!cacheSession.isCurrent()) return;
          enableUserInfoQuery();
          return span.span('auth.refresh_queries', async () =>
            queryClient.invalidateQueries()
          );
        });
      // Rebind this device's push registrations once the refetches above have
      // exercised the fresh session — registering earlier can race auth state
      // that is still settling. Fire-and-forget so login isn't blocked on the
      // notification service.
      fireAndForget(
        invalidated
          .catch(() => {})
          .then(() => {
            if (cacheSession.isCurrent()) return syncPushRegistrations();
          }),
        'push-registration'
      );
      await invalidated;
    } catch (error) {
      span.error('Account query refresh failed');
      throw error;
    }
  });
}

/** Ensure signed-in identity is cached; signed-out markers require a fresh auth fetch. */
export async function prefetchUserInfo() {
  // Skip prefetch if user doesn't appear to be authenticated.
  // This prevents unnecessary auth requests during unauthenticated flows.
  if (!hasLoginCookie()) return;

  // IDB restoration is independent of an in-flight auth fetch. Await it first
  // so an offline native launch can use restored identity without that fetch.
  await queryPersistence.restoreQuery(authKeys.userInfo.queryKey);
  if (!hasLoginCookie()) return;
  if (
    hasCachedUserIdentity(queryClient.getQueryData(authKeys.userInfo.queryKey))
  )
    return;

  await catchToResult(
    async () =>
      await queryClient.fetchQuery({
        queryKey: authKeys.userInfo.queryKey,
        queryFn: fetchLegacyUserPermissions,
        networkMode: 'always',
        // Even a fresh in-memory logout stub is not the new login's identity.
        staleTime: 0,
      })
  );
}

/** Fetch user info and return the data. Use when you need the result. */
export async function fetchUserInfo() {
  return queryClient.fetchQuery({
    queryKey: authKeys.userInfo.queryKey,
    queryFn: fetchLegacyUserPermissions,
    networkMode: 'always',
  });
}

/**
 * @deprecated Use invalidateUserInfo() instead
 */
const _updateUserInfo = invalidateUserInfo;
