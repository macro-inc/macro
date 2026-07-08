import type { Change, ContainerID, LoroDoc } from 'loro-crdt';
import { LoroMap } from 'loro-crdt';

// Read a node-map's `$.id`, if this container is a LoroMap with that structure.
function dollarId(c: ReturnType<LoroDoc['getContainerById']>): string | null {
  if (!(c instanceof LoroMap)) return null;
  const dollar = c.get('$');
  if (!(dollar instanceof LoroMap)) return null;
  const id = dollar.get('id');
  return typeof id === 'string' ? id : null;
}

// Read a node-map's lexical `type` field (paragraph/table/tablecell/…).
function nodeType(c: ReturnType<LoroDoc['getContainerById']>): string | null {
  if (!(c instanceof LoroMap)) return null;
  const t = c.get('type');
  return typeof t === 'string' ? t : null;
}

// Structural units whose id is stable across edits; diffStates pairs cell content
// on these (the inner paragraph's id can churn when an empty cell is first typed).
const STABLE_CONTAINERS = new Set(['tablecell', 'listitem']);

// The id diffStates keys an edit on — so attribution lines up with the diff:
//   - text inside a table cell / list item -> the innermost cell/item id (stable)
//   - text anywhere else                   -> the block directly wrapping it
// The climb yields node-maps [textNode, contentBlock, …ancestors…] (list
// containers between carry no `$.id`). chain[0] is the text node; chain[1] is its
// block. Climbing all the way to the top-level block instead would collapse every
// cell of a table onto the single `table` id (all edits look like one author).
function blockIdOfContainer(doc: LoroDoc, cid: ContainerID): string | null {
  const chain: Array<{ type: string | null; id: string }> = [];
  let cur = doc.getContainerById(cid)?.parent();
  while (cur) {
    const id = dollarId(cur);
    if (id) chain.push({ type: nodeType(cur), id });
    cur = cur.parent();
  }
  const cell = chain.find((n) => n.type && STABLE_CONTAINERS.has(n.type));
  return cell?.id ?? chain[1]?.id ?? chain[0]?.id ?? null;
}

/**
 * Map each node `$.id` to the user who last edited it, by walking the doc's op
 * history (oldest -> newest, last write wins).
 */
export function buildWhoMap(
  doc: LoroDoc,
  peerToUser: (peer: string) => string = (peer) => peer
): Map<string, string> {
  const whoMap = new Map<string, string>();

  const flat: Change[] = [];
  for (const changes of doc.getAllChanges().values()) {
    flat.push(...changes);
  }
  // Order by lamport (global causal clock) so "last write wins" is correct across
  // peers — timestamps can tie/skew and counter is per-peer. Tie-break by peer for
  // determinism.
  flat.sort(
    (a, b) =>
      a.lamport - b.lamport || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0)
  );

  for (const change of flat) {
    // Change satisfies IdSpan structurally; exportJsonInIdSpan gives us properly
    // typed JsonOp[] with container as ContainerID, unlike getOpsInChange (any[]).
    for (const jsonChange of doc.exportJsonInIdSpan(change)) {
      for (const op of jsonChange.ops) {
        if (!op.container.endsWith(':Text')) continue;
        const blockId = blockIdOfContainer(doc, op.container);
        if (blockId) whoMap.set(blockId, peerToUser(change.peer));
      }
    }
  }

  return whoMap;
}
