import { useUserId } from '@core/context/user';
import { useQuery } from '@tanstack/solid-query';
import { createDatabaseMarketingRepository } from './database-repository';

export const marketingQueryKey = (userId: string | undefined) =>
  ['email-marketing', userId ?? 'signed-out'] as const;

/** Module-scope factory so the cached queryFn never retains a view's scope. */
export function marketingEnrollmentsQueryOptions(userId: string | undefined) {
  return {
    queryKey: marketingQueryKey(userId),
    queryFn: () => createDatabaseMarketingRepository().load(),
    enabled: !!userId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  };
}

/** Shared enrollment snapshot for CRM, scoped to the signed-in account. */
export function useMarketingEnrollments() {
  const userId = useUserId();
  return useQuery(() => marketingEnrollmentsQueryOptions(userId()));
}
