import { debounce } from '@core/util/debounce';
import type { EntityData } from '@entity';
import { storageServiceClient } from '@service-storage/client';
import { queryClient } from '../client';
import { cachedSnapshotKeys } from './keys';

const STALE_MS = 5_000;
const GC_MS = 6_000;

function cachedSnapshotQueryOptions(documentId: string) {
  return {
    queryKey: cachedSnapshotKeys.bytes(documentId).queryKey,
    queryFn: () => storageServiceClient.fetchCachedSnapshot(documentId),
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  };
}

export function fetchCachedSnapshot(documentId: string): Promise<Uint8Array> {
  return queryClient.fetchQuery(cachedSnapshotQueryOptions(documentId));
}

export function prefetchCachedSnapshot(documentId: string): Promise<void> {
  return queryClient.prefetchQuery(cachedSnapshotQueryOptions(documentId));
}

/**
 * Prefetch the cached snapshot for an entity, but only if it's a markdown
 * document (the only entity kind that uses a Loro snapshot today). No-op
 * otherwise. Safe to call from hover handlers across surfaces.
 */
export function maybePrefetchSnapshot(entity: EntityData): void {
  if (entity.type === 'document' && entity.fileType === 'md') {
    prefetchCachedSnapshot(entity.id);
  }
}

const HOVER_PREFETCH_DELAY_MS = 150;

const scheduleSnapshotPrefetch = debounce(
  (entity: EntityData) => maybePrefetchSnapshot(entity),
  HOVER_PREFETCH_DELAY_MS
);

export function tryWarmSnapshot(entity: EntityData): void {
  scheduleSnapshotPrefetch(entity);
}
