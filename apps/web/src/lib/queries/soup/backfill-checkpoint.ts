import { makeEventListener } from '@solid-primitives/event-listener';

// Bump when a default backfill input or completion guarantee changes so
// persisted cursors cannot retain an older hydration contract.
// Restart old cursors whose core lane still included channels.
export const BACKFILL_VERSION = 19;

// Saving a checkpoint fires this in the tab that saved it; other tabs see the
// write as a `storage` event.
const CHECKPOINT_SAVED_EVENT = 'graphql-soup-backfill-checkpoint';

export type SoupBackfillCheckpoint = {
  userId: string;
  /** Durable cache data generation that owns this cursor and watermark. */
  storageGeneration: string | null;
  nextCursor: string | null;
  pagesFetched: number;
  completed: boolean;
  /** Start of the pass currently being fetched. */
  scanStartedAt: string | null;
  /** Safe lower bound applied to updatedAt filters on the next pass. */
  updatedSince: string | null;
  /** Wall-clock time when the most recent pass reached its final page. */
  completedAt: string | null;
};

type StoredSoupBackfillCheckpoint = Omit<
  SoupBackfillCheckpoint,
  'storageGeneration' | 'scanStartedAt' | 'updatedSince' | 'completedAt'
> &
  Partial<
    Pick<
      SoupBackfillCheckpoint,
      'storageGeneration' | 'scanStartedAt' | 'updatedSince' | 'completedAt'
    >
  >;

function checkpointKey(userId: string, checkpointId: string): string {
  return `graphql-soup-backfill:v${BACKFILL_VERSION}:${userId}:${checkpointId}`;
}

export function initialSoupBackfillCheckpoint(
  userId: string,
  storageGeneration: string | null = null
): SoupBackfillCheckpoint {
  return {
    userId,
    storageGeneration,
    nextCursor: null,
    pagesFetched: 0,
    completed: false,
    scanStartedAt: null,
    updatedSince: null,
    completedAt: null,
  };
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isCheckpoint(
  value: unknown,
  userId: string
): value is StoredSoupBackfillCheckpoint {
  if (!value || typeof value !== 'object') return false;

  const checkpoint = value as Partial<SoupBackfillCheckpoint>;
  return (
    checkpoint.userId === userId &&
    (typeof checkpoint.nextCursor === 'string' ||
      checkpoint.nextCursor === null) &&
    typeof checkpoint.pagesFetched === 'number' &&
    typeof checkpoint.completed === 'boolean' &&
    isOptionalString(checkpoint.storageGeneration) &&
    isOptionalString(checkpoint.scanStartedAt) &&
    isOptionalString(checkpoint.updatedSince) &&
    isOptionalString(checkpoint.completedAt)
  );
}

export function loadSoupBackfillCheckpoint(
  userId: string,
  checkpointId: string
): SoupBackfillCheckpoint {
  try {
    const saved = localStorage.getItem(checkpointKey(userId, checkpointId));
    if (!saved) return initialSoupBackfillCheckpoint(userId);

    const parsed: unknown = JSON.parse(saved);
    if (!isCheckpoint(parsed, userId))
      return initialSoupBackfillCheckpoint(userId);

    return {
      ...parsed,
      storageGeneration: parsed.storageGeneration ?? null,
      scanStartedAt: parsed.scanStartedAt ?? null,
      updatedSince: parsed.updatedSince ?? null,
      completedAt: parsed.completedAt ?? null,
    };
  } catch {
    // Restarting from the beginning is safe when storage is unavailable or
    // the saved checkpoint is malformed.
    return initialSoupBackfillCheckpoint(userId);
  }
}

export function saveSoupBackfillCheckpoint(
  checkpoint: SoupBackfillCheckpoint,
  checkpointId: string
): void {
  const key = checkpointKey(checkpoint.userId, checkpointId);
  try {
    localStorage.setItem(key, JSON.stringify(checkpoint));
  } catch {
    // A failed checkpoint write only causes already-cached pages to be fetched
    // again after restart.
    return;
  }
  window.dispatchEvent(
    new CustomEvent<string>(CHECKPOINT_SAVED_EVENT, { detail: key })
  );
}

/** Calls `onSave` whenever a lane's checkpoint is saved, in this tab or
 * another. Returns the unsubscribe. */
export function watchSoupBackfillCheckpoint(
  userId: string,
  checkpointId: string,
  onSave: () => void
): () => void {
  const key = checkpointKey(userId, checkpointId);
  const stopLocal = makeEventListener(
    window,
    CHECKPOINT_SAVED_EVENT,
    (event) => {
      if ((event as CustomEvent<string>).detail === key) onSave();
    }
  );
  const stopOther = makeEventListener(window, 'storage', (event) => {
    if (event.key === key || event.key === null) onSave();
  });
  return () => {
    stopLocal();
    stopOther();
  };
}

/** Whether a pass of the lane has reached its last page since the cache's
 * current storage generation began. A later pass in progress keeps it true. */
export function soupBackfillLaneCompleted(
  userId: string,
  checkpointId: string,
  storageGeneration: string
): boolean {
  const checkpoint = loadSoupBackfillCheckpoint(userId, checkpointId);
  return (
    checkpoint.completedAt !== null &&
    checkpoint.storageGeneration === storageGeneration
  );
}
