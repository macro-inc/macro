import type { HistorySession } from '@service-sync/client';

/** Largest gap in ms between consecutive edits that still counts as one session. */
export const SESSION_GAP_MS = 10 * 60 * 1000;

/**
 * The blank-markdown golden snapshot seeds every fresh document with one bogus
 * change at this fixed timestamp (ms). Filtered out so it never shows as a real
 * editing session.
 */
export const BOGUS_BLANK_MARKDOWN_GOLDEN_SNAPSHOT_HISTORY_MS = 1780516229000;

type EditEvent = { userId: string; tMs: number };

/**
 * Group `(userId, timestampMs)` events into per-user sessions. Within a user,
 * consecutive edits more than `gapMs` apart start a new session. Returns all
 * sessions sorted most-recent first (`endMs` desc).
 * Sessions may overlap across users editing at the same time.
 */
export function sessionize(
  events: readonly EditEvent[],
  gapMs: number = SESSION_GAP_MS
): HistorySession[] {
  const byUser = new Map<string, number[]>();
  for (const { userId, tMs } of events) {
    const list = byUser.get(userId);
    if (list) list.push(tMs);
    else byUser.set(userId, [tMs]);
  }

  const sessions: HistorySession[] = [];
  for (const [userId, editTimes] of byUser) {
    editTimes.sort((a, b) => a - b); // oldest to newest
    let start = editTimes[0];
    let end = editTimes[0];
    let count = 1;
    for (let i = 1; i < editTimes.length; i++) {
      const t = editTimes[i];
      if (t - end > gapMs) {
        sessions.push({ userId, startMs: start, endMs: end, count });
        start = t;
        count = 0;
      }
      end = t;
      count += 1;
    }
    sessions.push({ userId, startMs: start, endMs: end, count });
  }

  sessions.sort(
    (a, b) =>
      b.endMs - a.endMs ||
      b.startMs - a.startMs ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)
  );

  // Hide the known blank golden-snapshot session while preserving real sessions.
  return sessions.filter(
    (s) =>
      !(
        s.startMs === BOGUS_BLANK_MARKDOWN_GOLDEN_SNAPSHOT_HISTORY_MS &&
        s.endMs === BOGUS_BLANK_MARKDOWN_GOLDEN_SNAPSHOT_HISTORY_MS &&
        s.count === 1
      )
  );
}
