import { thrownResultErrorHasCode } from '@core/util/result';
import { QueryClient } from '@tanstack/solid-query';

/** The app's query defaults without persistence or the Soup normalizer. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) =>
        !thrownResultErrorHasCode(error, 'UNAUTHORIZED') &&
        !thrownResultErrorHasCode(error, 'FORBIDDEN') &&
        failureCount < 1,
    },
  },
});

export function useQueryClient() {
  return queryClient;
}

/** Nothing persists in the fixture: every persistence call resolves at once. */
export const queryPersistence = new Proxy(
  {},
  { get: () => async () => undefined }
);
