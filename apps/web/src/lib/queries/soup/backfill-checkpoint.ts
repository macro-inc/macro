import { makeEventListener } from '@solid-primitives/event-listener';
import {
  type SoupBackfillLane,
  soupBackfillCheckpointKey,
} from './backfill-contract';

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

// Holds the storage generation in which the lane last gave up.
function failureKey(checkpointKey: string): string {
  return `${checkpointKey}:failed`;
}

// What this tab wrote when storage refused it, so the tab still reads its
// own lanes' progress, with the checkpoint text stored when it was refused.
// A later write that storage takes drops the copy, and so does another tab
// storing the lane: a tab runs a lane only while holding its locks, so what
// the other tab stored is newer. A failure entry of null means this tab
// cleared the mark.
type Unsaved<T> = { value: T; over: string | null };
const unsavedCheckpoints = new Map<string, Unsaved<SoupBackfillCheckpoint>>();
const unsavedFailures = new Map<string, Unsaved<string | null>>();

function storedText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** This tab's unsaved copy for the lane `key`, while `stored` is still the
 * checkpoint text it was refused over. */
function unsavedCopy<T>(
  copies: Map<string, Unsaved<T>>,
  key: string,
  stored: string | null
): Unsaved<T> | undefined {
  const copy = copies.get(key);
  if (copy && copy.over !== stored) {
    copies.delete(key);
    return undefined;
  }
  return copy;
}

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

function parseCheckpoint(
  saved: string | null,
  userId: string
): SoupBackfillCheckpoint {
  try {
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
    // Restarting from the beginning is safe when the saved checkpoint is
    // malformed.
    return initialSoupBackfillCheckpoint(userId);
  }
}

/** A lane's checkpoint, with the stored text it was read from: null when
 * none is stored or storage is unavailable. When storage refused this tab's
 * last write, the tab's unsaved copy wins over the stored text. */
export function readSoupBackfillCheckpoint(
  userId: string,
  lane: SoupBackfillLane
): { stored: string | null; checkpoint: SoupBackfillCheckpoint } {
  const key = soupBackfillCheckpointKey(userId, lane);
  // Unavailable storage reads as none: restarting from the beginning is safe.
  const stored = storedText(key);
  const unsaved = unsavedCopy(unsavedCheckpoints, key, stored);
  return {
    stored,
    checkpoint: unsaved
      ? { ...unsaved.value }
      : parseCheckpoint(stored, userId),
  };
}

export function loadSoupBackfillCheckpoint(
  userId: string,
  lane: SoupBackfillLane
): SoupBackfillCheckpoint {
  return readSoupBackfillCheckpoint(userId, lane).checkpoint;
}

export function saveSoupBackfillCheckpoint(
  checkpoint: SoupBackfillCheckpoint,
  lane: SoupBackfillLane
): void {
  const key = soupBackfillCheckpointKey(checkpoint.userId, lane);
  try {
    localStorage.setItem(key, JSON.stringify(checkpoint));
    unsavedCheckpoints.delete(key);
  } catch {
    // Pages already cached are fetched again after a restart; until then
    // this tab reads the copy.
    unsavedCheckpoints.set(key, {
      value: { ...checkpoint },
      over: storedText(key),
    });
  }
  // A saved page means the lane runs again.
  try {
    localStorage.removeItem(failureKey(key));
    unsavedFailures.delete(key);
  } catch {
    unsavedFailures.set(key, { value: null, over: storedText(key) });
  }
  notifySaved(key);
}

/** Records that the lane gave up after its retries in `storageGeneration`.
 * Its next saved checkpoint clears the mark. Watchers of the lane hear it as
 * a save. */
export function markSoupBackfillLaneFailed(
  userId: string,
  lane: SoupBackfillLane,
  storageGeneration: string
): void {
  const key = soupBackfillCheckpointKey(userId, lane);
  try {
    localStorage.setItem(failureKey(key), storageGeneration);
    unsavedFailures.delete(key);
  } catch {
    // Other tabs keep waiting for the lane; this one reads the copy.
    unsavedFailures.set(key, {
      value: storageGeneration,
      over: storedText(key),
    });
  }
  notifySaved(key);
}

/** Whether the lane gave up in the cache's current storage generation and
 * has not saved a page since. */
export function soupBackfillLaneFailed(
  userId: string,
  lane: SoupBackfillLane,
  storageGeneration: string
): boolean {
  const key = soupBackfillCheckpointKey(userId, lane);
  const unsaved = unsavedCopy(unsavedFailures, key, storedText(key));
  if (unsaved) return unsaved.value === storageGeneration;
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
  lane: SoupBackfillLane,
  onSave: () => void
): () => void {
  const key = soupBackfillCheckpointKey(userId, lane);
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
  lane: SoupBackfillLane,
  storageGeneration: string
): boolean {
  const checkpoint = loadSoupBackfillCheckpoint(userId, lane);
  return (
    checkpoint.completedAt !== null &&
    checkpoint.storageGeneration === storageGeneration
  );
}
