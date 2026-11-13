import {
  duplicateIds,
  nodeId,
  normalizeState,
  type SerializedNode,
  type SerializedState,
} from './normalize';

/** The most top-level blocks one commit may send. */
export const MAX_BLOCKS = 500;

/** A new, changed or moved top-level block, placed after `after` (first when null). */
export type LexicalBlock = { id: string; after: string | null; node: unknown };

export type WantedOutcome = { state: SerializedState } | { invalid: string };

/**
 * The program's document: `base`'s top-level blocks without `removed`, with
 * each sent block replacing its namesake and placed after `after`. Blocks
 * arrive in document order, so each `after` is already placed.
 */
export function wantedState(
  base: SerializedState,
  blocks: LexicalBlock[],
  removed: string[]
): WantedOutcome {
  if (blocks.length > MAX_BLOCKS)
    return {
      invalid: `a commit sends at most ${MAX_BLOCKS} blocks, not ${blocks.length}`,
    };
  const baseBlocks = new Map(
    (base.root.children ?? []).map((node) => [nodeId(node), node])
  );
  const sent = new Set<string>();
  for (const block of blocks) {
    if (sent.has(block.id))
      return { invalid: `block "${block.id}" is sent more than once` };
    sent.add(block.id);
    if (!isNode(block.node))
      return {
        invalid: `block "${block.id}" is not a serialized Lexical node`,
      };
    if (nodeId(block.node) !== block.id)
      return {
        invalid: `block "${block.id}" holds a node with id "${nodeId(block.node)}"`,
      };
  }
  const removing = new Set(removed);
  for (const id of removing) {
    if (sent.has(id))
      return { invalid: `block "${id}" is both sent and removed` };
    if (!baseBlocks.has(id))
      return {
        invalid: `removed block "${id}" is not a top-level block of the revision`,
      };
  }

  const order: SerializedNode[] = [...baseBlocks]
    .filter(([id]) => id === null || !(removing.has(id) || sent.has(id)))
    .map(([, node]) => node);
  for (const block of blocks) {
    const index =
      block.after === null
        ? -1
        : order.findIndex((node) => nodeId(node) === block.after);
    if (block.after !== null && index === -1)
      return {
        invalid: `block "${block.id}" goes after "${block.after}", which is not a block before it`,
      };
    order.splice(index + 1, 0, block.node as SerializedNode);
  }

  let state: SerializedState;
  try {
    state = normalizeState({ root: { ...base.root, children: order } });
  } catch (error) {
    return {
      invalid: `the blocks are not a valid document: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const duplicates = duplicateIds(state.root);
  if (duplicates.length > 0)
    return {
      invalid: `ids appear more than once: ${duplicates.map((id) => `"${id}"`).join(', ')}`,
    };
  return { state };
}

function isNode(value: unknown): value is SerializedNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
