import type { AutomergeDoc, ContainerID } from '@macro-inc/automerge';
import { Automerge, AutomergeMap } from '@macro-inc/automerge';

// Read a node-map's `$.id`, if this container is a AutomergeMap with that structure.
function dollarId(
  c: ReturnType<AutomergeDoc['getContainerById']>
): string | null {
  if (!(c instanceof AutomergeMap)) return null;
  const dollar = c.get('$');
  if (!(dollar instanceof AutomergeMap)) return null;
  const id = dollar.get('id');
  return typeof id === 'string' ? id : null;
}

// Read a node-map's lexical `type` field (paragraph/table/tablecell/…).
function nodeType(
  c: ReturnType<AutomergeDoc['getContainerById']>
): string | null {
  if (!(c instanceof AutomergeMap)) return null;
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
function blockIdOfContainer(
  doc: AutomergeDoc,
  cid: ContainerID
): string | null {
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
  doc: AutomergeDoc,
  peerToUser: (peer: string) => string = (peer) => peer
): Map<string, string> {
  const whoMap = new Map<string, string>();

  for (const bytes of Automerge.getAllChanges(doc.value)) {
    const change = Automerge.decodeChange(bytes);
    const peer = BigInt(`0x${change.actor}`).toString();
    for (const op of change.ops) {
      const container = doc.getContainerById(op.obj);
      if (container?.kind() !== 'Text') continue;
      const blockId = blockIdOfContainer(doc, op.obj);
      if (blockId) whoMap.set(blockId, peerToUser(peer));
    }
  }
  return whoMap;
}
