/**
 * Finding a section's members that no loaded list holds, a batch at a time.
 *
 * A section can name thousands of channels the viewer's lists don't hold, and
 * a lookup can answer without some of them (left, deleted, or out of reach).
 * Discovery walks the member list once, from a cursor that only moves
 * forward: past members a source holds and past members a lookup missed.
 * The set of missed IDs a window remembers is bounded, so walking from the
 * start each time would ask for forgotten misses again, forever.
 */

/** Members asked for in one lookup, the size of a window chunk. */
export const MEMBER_DISCOVERY_BATCH = 25;

/** Misses discovery takes before it waits for Load more, per extension. */
export const MEMBER_DISCOVERY_MISSES = 100;

export type MemberDiscovery = {
  /** The member list the cursor indexes. */
  readonly ids: readonly string[];
  /** The first member discovery has not settled. */
  readonly cursor: number;
  /** Members passed because a lookup missed them. */
  readonly misses: number;
};

export type MemberDiscoverySources = {
  /** A source holds this member's record. */
  isKnown: (id: string) => boolean;
  /** A settled lookup answered without this member. */
  isUnavailable: (id: string) => boolean;
};

export type MemberDiscoveryStatus =
  /** Every member is held or missed. */
  | { kind: 'done' }
  /** The miss budget is spent; Load more extends it. */
  | { kind: 'paused' }
  /** These members are next to look up (some may be loading). */
  | { kind: 'next'; ids: readonly string[] };

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a === b || (a.length === b.length && a.every((id, index) => id === b[index]));

/** The miss budget after `extensions` presses of Load more. */
export const memberDiscoveryBudget = (extensions: number) =>
  MEMBER_DISCOVERY_MISSES * (1 + Math.max(0, extensions));

/**
 * Move the cursor past members that are held or were missed, stopping at the
 * first member still to look up, or at a miss once `budget` misses are
 * spent. A changed member list starts again from its first member. Returns
 * `previous` itself when nothing moved.
 */
export function advanceMemberDiscovery(
  previous: MemberDiscovery | undefined,
  ids: readonly string[],
  sources: MemberDiscoverySources,
  budget: number
): MemberDiscovery {
  const start =
    previous && sameIds(previous.ids, ids)
      ? previous
      : { ids, cursor: 0, misses: 0 };
  let cursor = start.cursor;
  let misses = start.misses;
  while (cursor < ids.length) {
    const id = ids[cursor];
    if (sources.isKnown(id)) {
      cursor += 1;
      continue;
    }
    if (!sources.isUnavailable(id) || misses >= budget) break;
    misses += 1;
    cursor += 1;
  }
  if (start === previous && cursor === start.cursor && misses === start.misses)
    return previous;
  return { ids: start.ids, cursor, misses };
}

/**
 * What discovery does next from where its cursor stands: once `budget`
 * misses are spent it asks for nothing more until Load more raises it.
 */
export function memberDiscoveryStatus(
  discovery: MemberDiscovery,
  sources: MemberDiscoverySources,
  budget: number
): MemberDiscoveryStatus {
  const { ids, cursor } = discovery;
  if (cursor >= ids.length) return { kind: 'done' };
  if (discovery.misses >= budget) return { kind: 'paused' };
  const next: string[] = [];
  for (
    let index = cursor;
    index < ids.length && next.length < MEMBER_DISCOVERY_BATCH;
    index += 1
  ) {
    const id = ids[index];
    if (!sources.isKnown(id) && !sources.isUnavailable(id)) next.push(id);
  }
  return { kind: 'next', ids: next };
}

/**
 * The records discovery found for the members of open sections, kept while
 * those sections stay open. The cursor has passed them, so a record the
 * window's bounded retention dropped would never be asked for again and its
 * row would go. Holds at most one record per member, the latest found;
 * returns `previous` itself when nothing changed.
 */
export function keepDiscoveredRecords<T extends { readonly id: string }>(
  previous: ReadonlyMap<string, T>,
  members: ReadonlySet<string>,
  found: readonly T[]
): ReadonlyMap<string, T> {
  let changed = false;
  const next = new Map<string, T>();
  for (const [id, record] of previous) {
    if (members.has(id)) next.set(id, record);
    else changed = true;
  }
  for (const record of found) {
    if (!members.has(record.id) || next.get(record.id) === record) continue;
    next.set(record.id, record);
    changed = true;
  }
  return changed ? next : previous;
}
