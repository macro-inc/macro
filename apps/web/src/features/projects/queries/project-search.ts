import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { initiativeClient } from '@service-storage/initiative';
import { useInfiniteQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { projectKeys } from './keys';

/** The command menu searches the same authorized project collection as Tasks. */
export function useProjectSearchQuery(
  search: Accessor<string>,
  enabled: Accessor<boolean>,
  userId: Accessor<string | undefined>
) {
  return useInfiniteQuery(
    () => {
      const query = search().trim();
      return {
        queryKey: projectKeys.command(userId(), query).queryKey,
        enabled: Boolean(userId()) && enabled(),
        initialPageParam: undefined as string | undefined,
        queryFn: ({ signal, pageParam }) =>
          throwOnErr(() =>
            initiativeClient.page(
              { query, cursor: pageParam, limit: 20 },
              signal
            )
          ),
        getNextPageParam: (last) => last.nextCursor ?? undefined,
        staleTime: 15_000,
      };
    },
    () => queryClient
  );
}
