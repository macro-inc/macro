import { catchToResult, throwOnErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { useQuery } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { queryClient } from '../client';
import { authKeys } from './keys';

export { authKeys } from './keys';

const USER_INFO_STALE_TIME = 15_000; // 15 seconds

type UserInfoData = Awaited<
  ReturnType<typeof authServiceClient.getLegacyUserPermissions>
>[1];

/** Query for the current user's info and permissions. */
export function useUserInfoQuery() {
  return useQuery(
    () => ({
      queryKey: authKeys.userInfo.queryKey,
      queryFn: async () =>
        throwOnErr(authServiceClient.getLegacyUserPermissions),
      staleTime: USER_INFO_STALE_TIME,
      suspense: false,
      refetchOnMount: false,
    }),
    () => queryClient
  );
}

/** Invalidate the user info query to trigger a refetch. */
export function invalidateUserInfo() {
  return queryClient.invalidateQueries({
    queryKey: authKeys.userInfo.queryKey,
  });
}

/** Ensure user info is in the query cache. Fetches if not present. */
export async function prefetchUserInfo() {
  await catchToResult(
    async () =>
      await queryClient.ensureQueryData({
        queryKey: authKeys.userInfo.queryKey,
      })
  );
}

/** Fetch user info and return the data. Use when you need the result. */
export async function fetchUserInfo() {
  return queryClient.fetchQuery({
    queryKey: authKeys.userInfo.queryKey,
  });
}

/**
 * @deprecated Use invalidateUserInfo() instead
 */
export const updateUserInfo = invalidateUserInfo;

// Derived state hooks - all use TanStack Query as single source of truth

/** Returns whether the user is authenticated. Returns undefined while loading. */
export function useIsAuthenticated() {
  const query = useUserInfoQuery();
  return createMemo((): boolean | undefined => {
    if (query.isLoading) return undefined;
    if (!query.data) return false;
    return query.data.authenticated ?? false;
  });
}

/** Returns the current user's ID. */
export function useUserId() {
  const query = useUserInfoQuery();
  return createMemo(() => {
    if (query.isLoading) return undefined;
    return query.data?.id;
  });
}

/** Returns the current user's email. */
export function useEmail() {
  const query = useUserInfoQuery();
  return createMemo(() => {
    if (query.isLoading) return undefined;
    return query.data?.email;
  });
}

/** Returns the current user's permissions. */
export function usePermissions() {
  const query = useUserInfoQuery();
  return createMemo(() => {
    if (query.isLoading) return [];
    return query.data?.permissions ?? [];
  });
}

/** Returns the current user's display name for authoring. */
export function useAuthor() {
  const query = useUserInfoQuery();
  return createMemo(() => {
    if (query.isLoading) return 'Macro User';
    return query.data?.name || query.data?.email || 'Macro User';
  });
}

/** Returns the current user's license status. */
export function useLicenseStatus() {
  const query = useUserInfoQuery();
  return createMemo(() => {
    if (query.isLoading) return undefined;
    return query.data?.licenseStatus;
  });
}

/** Returns whether the user has completed the tutorial. */
export function useTutorialCompleted() {
  const query = useUserInfoQuery();
  return createMemo(() => {
    if (query.isLoading) return undefined;
    return query.data?.tutorialComplete;
  });
}

/** Returns the user's group for A/B testing. */
export function useGroup() {
  const query = useUserInfoQuery();
  return createMemo(() => {
    if (query.isLoading) return undefined;
    return query.data?.group;
  });
}

/** Returns whether the user has the Chrome extension. */
export function useHasChromeExt() {
  const query = useUserInfoQuery();
  return createMemo(() => {
    if (query.isLoading) return undefined;
    return query.data?.hasChromeExt;
  });
}

/** Returns whether the user has trialed. */
export function useHasTrialed() {
  const query = useUserInfoQuery();
  return createMemo(() => {
    if (query.isLoading) return undefined;
    return query.data?.hasTrialed;
  });
}

/** Returns the full user info data. */
export function useUserInfo() {
  const query = useUserInfoQuery();
  return createMemo((): UserInfoData | undefined => {
    if (query.isLoading) return undefined;
    return query.data;
  });
}
