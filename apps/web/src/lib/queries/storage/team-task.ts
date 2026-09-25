import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { teamTaskKeys } from './keys';

// Cached callbacks outlive the caller; only the resolved slug enters them.
function teamTaskQueryOptions(slug: string | undefined) {
  return {
    queryKey: slug
      ? teamTaskKeys.bySlug(slug).queryKey
      : teamTaskKeys.bySlug._def,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      if (!slug) {
        throw new Error('A team-task slug is required');
      }

      // DSS resolves the slug against the authenticated user's team.
      return throwOnErr(() =>
        storageServiceClient.getDocumentByTeamSlug({ slug, signal })
      );
    },
    // Resolution failures are deterministic (404/403), so an automatic
    // retry only delays the not-found state; the route offers manual retry.
    retry: false,
    enabled: !!slug,
  };
}

/** Resolves a stable team-task slug to its canonical document. */
export function useTeamTaskQuery(slug: Accessor<string | undefined>) {
  return useQuery(() => teamTaskQueryOptions(slug()));
}
