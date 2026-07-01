import type { HistoryVersionId } from '@service-sync/client';
import type { SerializedEditorState } from 'lexical';
import type { Change, LoroDoc } from 'loro-crdt';

type Slot = { startMs: number; endMs: number };

// Each change gets a slot [startMs, endMs) evenly distributed within its second.
// e.g. 3 changes in second T → [T, T+333), [T+333, T+667), [T+667, T+1000)
function buildSlots(changes: Change[]): Slot[] {
  const slots = new Array<Slot>(changes.length);
  let i = 0;
  while (i < changes.length) {
    let j = i;
    const sec = changes[i].timestamp;
    while (j < changes.length && changes[j].timestamp === sec) j++;
    const count = j - i;
    for (let k = 0; k < count; k++) {
      slots[i + k] = {
        startMs: sec * 1000 + (k / count) * 1000,
        endMs: sec * 1000 + ((k + 1) / count) * 1000,
      };
    }
    i = j;
  }
  return slots;
}

// Within 5s of targetMs, expand changes into individual ops so scrubbing is
// per-keystroke. Outside the window, include entire changes for efficiency.
const EXPAND_WINDOW_MS = 5000;

function frontiersAt(changes: Change[], slots: Slot[], targetMs: number) {
  const maxByPeer = new Map<Change['peer'], number>();

  for (let i = 0; i < changes.length; i++) {
    const { startMs, endMs } = slots[i];
    if (startMs > targetMs) break;

    const change = changes[i];

    if (endMs > targetMs - EXPAND_WINDOW_MS) {
      // Within window: expand into individual ops
      const slotSpan = endMs - startMs;
      for (let k = 0; k < change.length; k++) {
        const opMs = startMs + (k / change.length) * slotSpan;
        if (opMs > targetMs) break;
        const counter = change.counter + k;
        if (counter > (maxByPeer.get(change.peer) ?? -1))
          maxByPeer.set(change.peer, counter);
      }
    } else {
      // Outside window: include entire change
      const endCounter = change.counter + change.length - 1;
      if (endCounter > (maxByPeer.get(change.peer) ?? -1))
        maxByPeer.set(change.peer, endCounter);
    }
  }

  return [...maxByPeer.entries()].map(([peer, counter]) => ({ peer, counter }));
}

export function buildTimestampIndex(doc: LoroDoc) {
  const changes = [...doc.getAllChanges().values()]
    .flat()
    .sort((a, b) => a.timestamp - b.timestamp || a.counter - b.counter);
  const slots = buildSlots(changes);

  return {
    checkoutAt(targetMs: number): SerializedEditorState | null {
      const frontiers = frontiersAt(changes, slots, targetMs);
      if (frontiers.length === 0) return null;
      doc.checkout(frontiers);
      const state = doc.toJSON() as SerializedEditorState;
      if (!state.root?.type) return null;
      return state;
    },

    versionIdAt(targetMs: number): HistoryVersionId | null {
      const frontiers = frontiersAt(changes, slots, targetMs);
      if (frontiers.length === 0) return null;
      const f = frontiers[frontiers.length - 1];
      return { peer: String(f.peer), counter: f.counter };
    },
  };
}
