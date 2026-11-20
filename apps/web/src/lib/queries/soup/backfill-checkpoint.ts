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

// Holds the storage generation in which the lane last gave up.
function failureKey(checkpointKey: string): string {
  return `${checkpointKey}:failed`;
}

// What this tab wrote when storage refused it, so the tab still reads its
// own lanes' progress; a later write that storage takes drops the copy. A
// failure entry of null means this tab cleared the mark.
const unsavedCheckpoints = new Map<string, SoupBackfillCheckpoint>();
const unsavedFailures = new Map<string, string | null>();

function notifySaved(key: string) {
  window.dispatchEvent(
    new CustomEvent<string>(CHECKPOINT_SAVED_EVENT, { detail: key })
  );
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
  const unsaved = unsavedCheckpoints.get(checkpointKey(userId, checkpointId));
  if (unsaved) return { ...unsaved };
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
    unsavedCheckpoints.delete(key);
  } catch {
    // Pages already cached are fetched again after a restart; until then
    // this tab reads the copy.
    unsavedCheckpoints.set(key, { ...checkpoint });
  }
  // A saved page means the lane runs again.
  try {
    localStorage.removeItem(failureKey(key));
    unsavedFailures.delete(key);
  } catch {
    unsavedFailures.set(key, null);
  }
  notifySaved(key);
}

/** Records that the lane gave up after its retries in `storageGeneration`.
 * Its next saved checkpoint clears the mark. Watchers of the lane hear it as
 * a save. */
export function markSoupBackfillLaneFailed(
  userId: string,
  checkpointId: string,
  storageGeneration: string
): void {
  const key = checkpointKey(userId, checkpointId);
  try {
    localStorage.setItem(failureKey(key), storageGeneration);
    unsavedFailures.delete(key);
  } catch {
    // Other tabs keep waiting for the lane; this one reads the copy.
    unsavedFailures.set(key, storageGeneration);
  }
  notifySaved(key);
}

/** Whether the lane gave up in the cache's current storage generation and
 * has not saved a page since. */
export function soupBackfillLaneFailed(
  userId: string,
  checkpointId: string,
  storageGeneration: string
): boolean {
  const key = checkpointKey(userId, checkpointId);
  if (unsavedFailures.has(key))
    return unsavedFailures.get(key) === storageGeneration;
  try {
    return localStorage.getItem(failureKey(key)) === storageGeneration;
  } catch {
    return false;
  }
}

/** Calls `onSave` whenever a lane's checkpoint is saved or the lane gives
 * up, in this tab or another. Returns the unsubscribe. */
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
  const failure = failureKey(key);
  const stopOther = makeEventListener(window, 'storage', (event) => {
    if (event.key === key || event.key === failure || event.key === null)
      onSave();
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
