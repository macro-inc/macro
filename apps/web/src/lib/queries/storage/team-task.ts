import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { teamTaskKeys } from './keys';

/** Resolves a stable team-task slug to its canonical document. */
export function useTeamTaskQuery(slug: Accessor<string | undefined>) {
  return useQuery(() => {
    const currentSlug = slug();

    return {
      queryKey: currentSlug
        ? teamTaskKeys.bySlug(currentSlug).queryKey
        : teamTaskKeys.bySlug._def,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        if (!currentSlug) {
          throw new Error('A team-task slug is required');
        }

        // DSS resolves the slug against the authenticated user's team.
        return throwOnErr(() =>
          storageServiceClient.getDocumentByTeamSlug({
            slug: currentSlug,
            signal,
          })
        );
      },
      // Resolution failures are deterministic (404/403), so an automatic
      // retry only delays the not-found state; the route offers manual retry.
      retry: false,
      enabled: !!currentSlug,
    };
  });
}
