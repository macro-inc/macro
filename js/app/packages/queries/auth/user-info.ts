import { useAuthUserInfo } from '@core/auth';
import { throwOnErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { useQuery } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { queryClient } from '../client';
import { authKeys } from './keys';

export { authKeys } from './keys';

const USER_INFO_STALE_TIME = 15_000; // 15 seconds (matches previous cache)

type UserInfoData = Awaited<
  ReturnType<typeof authServiceClient.getLegacyUserPermissions>
>[1];

function userInfoQueryOptions() {
  return {
    queryKey: authKeys.userInfo.queryKey,
    queryFn: async () => throwOnErr(authServiceClient.getLegacyUserPermissions),
    staleTime: USER_INFO_STALE_TIME,
  };
}

/** Query for the current user's info and permissions. Use this when you need TanStack Query features. */
export function useUserInfoQuery() {
  return useQuery(() => userInfoQueryOptions());
}

/** Invalidate the user info query to trigger a refetch. */
export function invalidateUserInfo() {
  return queryClient.invalidateQueries({
    queryKey: authKeys.userInfo.queryKey,
  });
}

/** Prefetch user info and populate the query cache. Can be used outside QueryClientProvider. */
export async function prefetchUserInfo() {
  return queryClient.fetchQuery(userInfoQueryOptions());
}

/**
 * @deprecated Use invalidateUserInfo() instead
 */
export const updateUserInfo = invalidateUserInfo;

// Derived state hooks - these use the singleton resource (works outside QueryClientProvider)

/** Returns the current user's ID. */
export function useUserId() {
  const [resource] = useAuthUserInfo();
  return createMemo(() => {
    const [, data] = resource.latest;
    return data?.id;
  });
}

/** Returns the current user's email. */
export function useEmail() {
  const [resource] = useAuthUserInfo();
  return createMemo(() => {
    const [, data] = resource.latest;
    return data?.email;
  });
}

/** Returns the current user's permissions. */
export function usePermissions() {
  const [resource] = useAuthUserInfo();
  return createMemo(() => {
    const [, data] = resource.latest;
    return data?.permissions ?? [];
  });
}

/** Returns the current user's display name for authoring. */
export function useAuthor() {
  const [resource] = useAuthUserInfo();
  return createMemo(() => {
    const [, data] = resource.latest;
    return data?.name || data?.email || 'Macro User';
  });
}

/** Returns the current user's license status. */
export function useLicenseStatus() {
  const [resource] = useAuthUserInfo();
  return createMemo(() => {
    const [, data] = resource.latest;
    return data?.licenseStatus;
  });
}

/** Returns whether the user has completed the tutorial. */
export function useTutorialCompleted() {
  const [resource] = useAuthUserInfo();
  return createMemo(() => {
    const [, data] = resource.latest;
    return data?.tutorialComplete;
  });
}

/** Returns the user's group for A/B testing. */
export function useGroup() {
  const [resource] = useAuthUserInfo();
  return createMemo(() => {
    const [, data] = resource.latest;
    return data?.group;
  });
}

/** Returns whether the user has the Chrome extension. */
export function useHasChromeExt() {
  const [resource] = useAuthUserInfo();
  return createMemo(() => {
    const [, data] = resource.latest;
    return data?.hasChromeExt;
  });
}

/** Returns whether the user has trialed. */
export function useHasTrialed() {
  const [resource] = useAuthUserInfo();
  return createMemo(() => {
    const [, data] = resource.latest;
    return data?.hasTrialed;
  });
}

/** Returns the full user info data. */
export function useUserInfo() {
  const [resource] = useAuthUserInfo();
  return createMemo((): UserInfoData | undefined => {
    const [, data] = resource.latest;
    return data;
  });
}
