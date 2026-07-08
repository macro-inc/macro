export type ActivitySession = {
  userId: string;
  startMs: number;
  endMs: number;
  count: number;
};

export type ActivityRow = {
  userIds: string[];
  startMs: number;
  endMs: number;
  count: number;
  label: string;
};

// Algorithm for bucketing:
//
// 1. Sort sessions newest-first (by endMs, then startMs).
// 2. Bucket each session into an age tier by how long ago its endMs was.
//    Tiers widen as they get older (last 10 min, last hour, last day, ...).
//    Great, we have a bunch of bucketed sessions now. Let's cluster within
//    sessions.
// 3. Within each tier, walk newest->oldest and accumulate sessions into a
//    group while the group's total span (newest end − oldest start) stays
//    under that tier's maxActiveSpanMs. When adding one would exceed it,
//    emit the group as a row and start a new group. Coarser tiers tolerate
//    wider spans, so old activity is grouped more loosely than recent.
// 4. Sessions older than the last tier collapse into a single trailing row.
// 5. Emit each group as a summarized row with a relative label.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

// these "feel right" but we can change it
const ACTIVITY_TIERS = [
  { boundaryMs: 10 * MINUTE_MS, maxActiveSpanMs: 10 * MINUTE_MS },
  { boundaryMs: HOUR_MS, maxActiveSpanMs: HOUR_MS },
  { boundaryMs: DAY_MS, maxActiveSpanMs: 4 * HOUR_MS },
  { boundaryMs: 3 * DAY_MS, maxActiveSpanMs: 8 * HOUR_MS },
  { boundaryMs: WEEK_MS, maxActiveSpanMs: DAY_MS },
  { boundaryMs: 2 * WEEK_MS, maxActiveSpanMs: 2 * DAY_MS },
  { boundaryMs: MONTH_MS, maxActiveSpanMs: 3 * DAY_MS },
  { boundaryMs: 6 * MONTH_MS, maxActiveSpanMs: WEEK_MS },
  { boundaryMs: 2 * YEAR_MS, maxActiveSpanMs: MONTH_MS },
] as const;

function activityLabel(endMs: number, nowMs: number) {
  const ageMs = Math.max(0, nowMs - endMs);
  if (ageMs < MINUTE_MS) return 'just now';
  if (ageMs < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(ageMs / MINUTE_MS));
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (ageMs < DAY_MS) {
    const hours = Math.max(1, Math.floor(ageMs / HOUR_MS));
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  if (ageMs < WEEK_MS) {
    const days = Math.max(1, Math.floor(ageMs / DAY_MS));
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }
  const weeks = Math.max(1, Math.floor(ageMs / WEEK_MS));
  if (ageMs < 8 * WEEK_MS) {
    return weeks === 1 ? 'last week' : `${weeks} weeks ago`;
  }

  const date = new Date(endMs);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function createRow(
  sessions: readonly ActivitySession[],
  nowMs: number
): ActivityRow {
  const userIds: string[] = [];
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = 0;
  let count = 0;

  for (const session of sessions) {
    if (!userIds.includes(session.userId)) userIds.push(session.userId);
    startMs = Math.min(startMs, session.startMs);
    endMs = Math.max(endMs, session.endMs);
    count += session.count;
  }

  return {
    userIds,
    startMs,
    endMs,
    count,
    label: activityLabel(endMs, nowMs),
  };
}

export function buildActivityRows(
  sessions: readonly ActivitySession[],
  nowMs: number = Date.now()
): ActivityRow[] {
  const sorted = [...sessions].sort(
    (a, b) => b.endMs - a.endMs || b.startMs - a.startMs
  );
  const rows: ActivityRow[] = [];
  let cursor = 0;
  let previousBoundaryMs = nowMs;

  for (const tier of ACTIVITY_TIERS) {
    const tierBoundaryMs = nowMs - tier.boundaryMs;
    const tierSessions: ActivitySession[] = [];

    while (cursor < sorted.length) {
      const session = sorted[cursor];
      if (session.endMs > previousBoundaryMs) {
        cursor++;
        continue;
      }
      if (session.endMs <= tierBoundaryMs) break;
      tierSessions.push(session);
      cursor++;
    }

    let group: ActivitySession[] = [];
    for (const session of tierSessions) {
      if (group.length === 0) {
        group = [session];
        continue;
      }

      const groupEndMs = Math.max(...group.map((item) => item.endMs));
      const nextStartMs = Math.min(
        session.startMs,
        ...group.map((item) => item.startMs)
      );
      if (groupEndMs - nextStartMs > tier.maxActiveSpanMs) {
        rows.push(createRow(group, nowMs));
        group = [session];
      } else {
        group.push(session);
      }
    }

    if (group.length > 0) {
      rows.push(createRow(group, nowMs));
    }

    previousBoundaryMs = tierBoundaryMs;
  }

  if (cursor < sorted.length) {
    const remaining = sorted.slice(cursor);
    rows.push(createRow(remaining, nowMs));
  }

  return rows;
}
