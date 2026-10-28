import type { GroupMeta } from './types';

/** Membership metadata only; presentation resolves labels after reconciliation. */
export type ReconciledSoupBin = Pick<
  GroupMeta,
  'key' | 'totalCount' | 'itemIds' | 'nextCursor'
>;

/** One loaded row, in locally evaluated sort order. */
export type GroupedSoupMembership = {
  id: string;
  /** Complete membership at the server baseline, when known. Not just loaded bins. */
  previousGroupKeys?: readonly string[];
  /** Undefined is unknown; [] proves exclusion from this view. */
  groupKeys?: readonly string[];
};

function collectGroupedBaseline(baseline: readonly ReconciledSoupBin[]) {
  const bins = new Map<string, ReconciledSoupBin>();
  const memberships = new Map<string, Set<string>>();
  for (const bin of baseline) {
    if (!bins.has(bin.key)) bins.set(bin.key, { ...bin, itemIds: [] });
    for (const id of bin.itemIds) {
      const keys = memberships.get(id) ?? new Set<string>();
      keys.add(bin.key);
      memberships.set(id, keys);
    }
  }
  return { bins, memberships };
}

/**
 * Reconcile loaded server membership, not an exhaustive local collection.
 * Pass initial bins before continuation bins; repeated bins contribute rows,
 * not counts or cursors. The owner retains each continuation's paging cursor.
 *
 * Rows absent from the evaluation retain their server membership (for example,
 * a page loaded while evaluation was in flight). Candidates absent from every
 * baseline bin are ignored: their contribution to server totals is unproven.
 */
export function reconcileGroupedSoup(
  baseline: readonly ReconciledSoupBin[],
  evaluated: readonly GroupedSoupMembership[]
): ReconciledSoupBin[] {
  const { bins, memberships } = collectGroupedBaseline(baseline);
  const visited = new Set<string>();
  for (const row of evaluated) {
    const loadedKeys = memberships.get(row.id);
    if (!loadedKeys || visited.has(row.id)) continue;
    visited.add(row.id);
    const nextKeys = new Set(row.groupKeys ?? loadedKeys);
    const previousKeys = new Set(row.previousGroupKeys ?? loadedKeys);
    // Unknown current membership cannot justify any count changes, even when
    // the previous complete membership includes unloaded bins.
    if (row.groupKeys !== undefined) {
      for (const key of previousKeys) {
        const bin = bins.get(key);
        if (bin && !nextKeys.has(key)) bin.totalCount -= 1;
      }
    }
    for (const key of nextKeys) {
      let bin = bins.get(key);
      if (!bin) {
        bin = { key, totalCount: 0, itemIds: [], nextCursor: null };
        bins.set(key, bin);
      }
      // A row loaded in A might already be an unloaded member of B. Only a
      // complete old membership can prove that entering B increases its count.
      if (
        row.groupKeys !== undefined &&
        row.previousGroupKeys !== undefined &&
        !previousKeys.has(key)
      )
        bin.totalCount += 1;
      bin.itemIds.push(row.id);
    }
  }
  for (const [id, keys] of memberships) {
    if (visited.has(id)) continue;
    for (const key of keys) bins.get(key)?.itemIds.push(id);
  }
  return [...bins.values()].map((bin) => ({
    ...bin,
    // Partial evidence never permits a negative count, or less than the rows
    // actually visible. Retain empty bins and their cursors for unloaded rows.
    totalCount: Math.max(bin.totalCount, bin.itemIds.length),
  }));
}
