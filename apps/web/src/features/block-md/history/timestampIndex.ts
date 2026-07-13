import type { HistoryVersionId } from '@service-sync/client';
import type { SerializedEditorState } from 'lexical';
import type { Change, LoroDoc } from 'loro-crdt';

function frontiersAt(changes: Change[], targetMs: number) {
  // Maintain a proper frontier antichain: when a change's deps cover a peer already
  // in the frontier, that peer is now in the causal past and must be pruned. Without
  // this, we'd pass non-antichain frontiers to checkout() which Loro rejects.
  const frontier = new Map<Change['peer'], number>();
  for (const { peer, counter, length, timestamp, deps } of changes) {
    if (timestamp * 1000 > targetMs) break;
    const endCounter = counter + length - 1;
    for (const dep of deps) {
      const cur = frontier.get(dep.peer);
      if (cur !== undefined && cur <= dep.counter) frontier.delete(dep.peer);
    }
    if (endCounter > (frontier.get(peer) ?? -1)) frontier.set(peer, endCounter);
  }
  return [...frontier.entries()].map(([peer, counter]) => ({ peer, counter }));
}

export function buildTimestampIndex(doc: LoroDoc) {
  const changes = [...doc.getAllChanges().values()]
    .flat()
    .sort((a, b) => a.timestamp - b.timestamp || a.counter - b.counter);

  return {
    checkoutAt(targetMs: number): SerializedEditorState | null {
      const frontiers = frontiersAt(changes, targetMs);
      if (frontiers.length === 0) return null;
      doc.checkoutToLatest();
      doc.checkout(frontiers);
      const state = doc.toJSON();
      if (!state.root?.type) return null;
      return state;
    },

    versionIdAt(targetMs: number): HistoryVersionId | null {
      const frontiers = frontiersAt(changes, targetMs);
      if (frontiers.length === 0) return null;
      const f = frontiers[frontiers.length - 1];
      return { peer: String(f.peer), counter: f.counter };
    },
  };
}
