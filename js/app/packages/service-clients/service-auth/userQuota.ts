import { isOk } from '@core/util/maybeResult';
import { QueryClient, useQuery } from '@tanstack/solid-query';
import { authServiceClient } from './client';
import type { UserQuota } from './generated/schemas';

const queryClient = new QueryClient();

/**
 * Fetches the user's quota information.
 * Returns the UserQuota data or throws an error if the request fails.
 */
const getUserQuota = async (): Promise<UserQuota> => {
  const result = await authServiceClient.userQuota();

  if (isOk(result)) {
    const [, quota] = result;
    return quota;
  }

  const [error] = result;
  const [{ code, message }] = error;
  console.error('Error getting user quota', error);
  throw new Error(`Failed to get user quota: ${code} - ${message}`);
};

/**
 * useQuery hook for retrieving the user's quota information.
 * Returns the current quota including documents, AI chat messages, and their limits.
 */
export function useUserQuotaQuery() {
  const query = useQuery(
    () => ({
      queryKey: ['userQuota'],
      queryFn: getUserQuota,
      staleTime: 1000 * 60 * 5, // 5 minutes
      throwOnError: false,
      retry: 1,
      retryOnMount: false,
    }),
    () => queryClient
  );
  return query;
}

/**
 * Invalidates the user quota query cache.
 * Useful for refreshing quota data after mutations that might affect it (e.g., sending AI chat messages).
 */
export function invalidateUserQuota() {
  queryClient.invalidateQueries({ queryKey: ['userQuota'] });
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
    queryClient.setQueryData(['userQuota'], quota);
  };
}
