import { authServiceClient } from '@service-auth/client';
import type { UserQuota } from '@service-auth/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { authKeys } from './keys';

const USER_QUOTA_STALE_TIME = 1000 * 60 * 5; // 5 minutes

/**
 * Fetches the user's quota information.
 * Returns the UserQuota data or throws an error if the request fails.
 */
const getUserQuota = async (): Promise<UserQuota> => {
  const result = await authServiceClient.userQuota();

  if (result.isOk()) {
    const quota = result.value;
    return quota;
  }

  const error = result.error;
  const [{ code, message }] = error;
  console.error('Error getting user quota', error);
  throw new Error(`Failed to get user quota: ${code} - ${message}`);
};

function userQuotaQueryOptions() {
  return {
    queryKey: authKeys.userQuota.queryKey,
    queryFn: getUserQuota,
    staleTime: USER_QUOTA_STALE_TIME,
    throwOnError: false,
    retry: 1,
    retryOnMount: false,
  };
}

/**
 * useQuery hook for retrieving the user's quota information.
 * Returns the current quota including documents, AI chat messages, and their limits.
 */
export function useUserQuotaQuery() {
  return useQuery(() => userQuotaQueryOptions());
}

/**
 * Invalidates the user quota query cache.
 * Useful for refreshing quota data after mutations that might affect it (e.g., sending AI chat messages).
 */
export function invalidateUserQuota() {
  return queryClient.invalidateQueries({
    queryKey: authKeys.userQuota.queryKey,
  });
}

/**
 * Hook to get a function that invalidates the user quota query cache.
 * Useful for refreshing quota data after mutations that might affect it.
 */
export function useInvalidateUserQuota() {
  return invalidateUserQuota;
}

/**
 * Hook to get a function that updates the user quota in the query cache.
 * Useful for optimistic updates when quota changes are known.
 */
export function useUpdateUserQuotaCache() {
  return (quota: UserQuota) => {
    queryClient.setQueryData(authKeys.userQuota.queryKey, quota);
  };
}
