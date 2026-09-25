import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';

const KEYS = {
  all: ['starterDocs'] as const,
};

/** Starter docs are seeded once at signup and rarely change. */
const STARTER_DOCS_STALE_TIME = 5 * 60 * 1000;

/**
 * Ids of the documents seeded for the user at signup. Resolved server-side —
 * clients should never identify a starter doc by name.
 */
function fetchStarterDocs() {
  return throwOnErr(() => storageServiceClient.getStarterDocs());
}

export function useStarterDocsQuery() {
  return useQuery(() => ({
    queryKey: KEYS.all,
    queryFn: fetchStarterDocs,
    staleTime: STARTER_DOCS_STALE_TIME,
  }));
}
