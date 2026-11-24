// Under load, notifiers write to the very viewers a read compares, and the two
// sides' reads are not one instant. A read under load therefore records its
// write window: the database clock before it starts, and every entity the
// viewer was notified about from then until it finished. A difference
// confined to those entities is the race, not the readers (closure W1);
// everything else is compared as usual.

import type { DomRow, Snapshot } from './compare.ts';
import { q, sql, type Stack } from './stack.ts';

/** The database clock, which stamps user_notification.created_at. */
export async function dbNow(stack: Stack): Promise<string> {
  const [row] = await sql<{ now: string }>(stack, `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`);
  return row.now;
}

export type Window = { since: string; notifications: number; entities: Set<string> };

/** The entities `userId` was notified about from `since` to now. */
export async function notifiedSince(stack: Stack, userId: string, since: string): Promise<Window> {
  const rows = await sql<{ primary_id: string; secondary_id: string | null }>(
    stack,
    `SELECT un.event_item_id AS primary_id, n.secondary_event_item_id AS secondary_id FROM user_notification un JOIN notification n ON n.id = un.notification_id WHERE un.user_id = ${q(userId)} AND un.created_at >= ${q(since)}::timestamptz`
  );
  const entities = new Set<string>();
  for (const r of rows) {
    entities.add(r.primary_id);
    if (r.secondary_id) entities.add(r.secondary_id);
  }
  return { since, notifications: rows.length, entities };
}

const idOf = (entity: unknown) => String((entity as { id?: unknown }).id);

/**
 * Both snapshots without the entities notified in the window. A read that
 * stopped at its page limit holds the list's first rows only, so a raced row
 * that moved up pushed another past the limit on one side: both are cut to
 * the shorter length. A grouped read's groups count and order every row, so
 * when either side held a raced entity its groups are not compared.
 */
export function withoutRaced<S extends Snapshot>(a: S, b: S, raced: Set<string>): [S, S] {
  const strip = (s: S) => s.entities.filter((e) => !raced.has(idOf(e)));
  let [x, y] = [strip(a), strip(b)];
  const held = x.length !== a.entities.length || y.length !== b.entities.length;
  if (held && (a.hasNextPage || b.hasNextPage)) {
    const n = Math.min(x.length, y.length);
    [x, y] = [x.slice(0, n), y.slice(0, n)];
  }
  const groups = (s: S) => (held ? null : s.groups);
  const items = (s: S) => (s.itemsById ? Object.fromEntries(Object.entries(s.itemsById).filter(([id]) => !raced.has(id))) : s.itemsById);
  return [
    { ...a, entities: x, groups: groups(a), itemsById: items(a) },
    { ...b, entities: y, groups: groups(b), itemsById: items(b) },
  ];
}

/** The entity id inside a Home row id (`…|s36:<uuid>|…`). */
export function domRowEntityId(row: DomRow): string | null {
  if (row.kind !== 'entity') return null;
  const match = row.id.match(/s36:([0-9a-f-]{36})/);
  return match ? match[1] : null;
}

/** Home rows without the raced entities, and without date headers left with no rows. */
export function domWithoutRaced(rows: DomRow[], raced: Set<string>): DomRow[] {
  const kept = rows.filter((row) => {
    const id = domRowEntityId(row);
    return id === null || !raced.has(id);
  });
  return kept.filter((row, i) => row.kind !== 'header' || kept[i + 1]?.kind === 'entity');
}
