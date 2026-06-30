import type { HistoryVersionId } from '@service-sync/client';
import type { Change, LoroDoc } from 'loro-crdt';
import type { SerializedEditorState } from 'lexical';

export type TimestampIndex = {
  doc: LoroDoc;
  /** All changes sorted by (timestamp, counter) ascending. */
  changes: Change[];
};

export function buildTimestampIndex(doc: LoroDoc): TimestampIndex {
  const changes = [...doc.getAllChanges().values()]
    .flat()
    .sort((a, b) => a.timestamp - b.timestamp || a.counter - b.counter);
  return { doc, changes };
}

// Frontiers for the version including every change at or before `targetMs`.
// Seeded from the shallow-snapshot baseline (empty for a full snapshot) so the
// result never lands before the shallow history's start version. Ascending sort
// means setLast applies same-peer changes in counter order, so each peer ends at
// its max included counter.
function frontiersAt(index: TimestampIndex, targetMs: number) {
  const targetSec = Math.floor(targetMs / 1000);
  const vv = index.doc.shallowSinceVV();
  for (const change of index.changes) {
    if (change.timestamp > targetSec) break;
    vv.setLast(change);
  }
  return index.doc.vvToFrontiers(vv);
}

export function checkoutAt(
  index: TimestampIndex,
  targetMs: number
): SerializedEditorState | null {
  const frontiers = frontiersAt(index, targetMs);
  if (frontiers.length === 0) return null;
  index.doc.checkout(frontiers);
  return index.doc.toJSON() as SerializedEditorState;
}

export function versionIdAt(
  index: TimestampIndex,
  targetMs: number
): HistoryVersionId | null {
  const frontiers = frontiersAt(index, targetMs);
  if (frontiers.length === 0) return null;
  const f = frontiers[frontiers.length - 1];
  return { peer: String(f.peer), counter: f.counter };
}
