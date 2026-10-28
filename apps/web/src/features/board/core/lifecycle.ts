import type { BoardItem } from './item';

/**
 * What the board remembers per viewer about each item, independent of the
 * variant showing it. Timestamps are epoch milliseconds.
 */
export type BoardRecall = {
  /** Activity time the item had when it was closed; newer activity brings it back. */
  dismissedAt?: number;
  /** When it was last opened from the board. */
  seenAt?: number;
  /** Moved by hand, so it stays until closed. */
  pinned?: boolean;
};

/**
 * - `live`: something happened in the last few minutes.
 * - `fresh`: unread, needs the viewer, or recently active.
 * - `settled`: read and quiet for a while; shown dimmed.
 * - `expired`: read and quiet for a day; leaves the board.
 * - `dismissed`: closed by the viewer with nothing new since.
 */
export type BoardFreshness =
  | 'live'
  | 'fresh'
  | 'settled'
  | 'expired'
  | 'dismissed';

export const LIVE_WINDOW_MS = 5 * 60_000;
export const SETTLE_AFTER_MS = 3 * 3_600_000;
export const EXPIRE_AFTER_MS = 24 * 3_600_000;

/**
 * Where an item is in its life on the board. Opening an item restarts its
 * quiet clock, so it does not vanish the moment its modal closes.
 */
export function itemFreshness(
  item: BoardItem,
  recall: BoardRecall | undefined,
  now: number
): BoardFreshness {
  if (
    recall?.dismissedAt !== undefined &&
    item.lastActivityAt <= recall.dismissedAt
  ) {
    return 'dismissed';
  }
  if (now - item.lastActivityAt < LIVE_WINDOW_MS) return 'live';
  if (item.unreadCount > 0 || item.needsYou) return 'fresh';

  const quietSince = Math.max(item.lastActivityAt, recall?.seenAt ?? 0);
  const quietFor = now - quietSince;
  if (quietFor < SETTLE_AFTER_MS) return 'fresh';
  if (recall?.pinned || quietFor < EXPIRE_AFTER_MS) return 'settled';
  return 'expired';
}

/** Whether an item takes a place on the board. */
export function isOnBoard(
  freshness: BoardFreshness,
  showSettled: boolean
): boolean {
  if (freshness === 'dismissed') return false;
  if (freshness === 'expired') return showSettled;
  return true;
}

/** Settled and expired items fade so the active work reads first. */
export function isFaded(freshness: BoardFreshness): boolean {
  return freshness === 'settled' || freshness === 'expired';
}
