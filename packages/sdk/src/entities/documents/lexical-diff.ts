import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';

/** A top-level block to write: new, changed or moved. */
export interface LexicalBlockChange {
  id: string;
  /** The id of the block before it in the edited document, or null when first. */
  after: string | null;
  node: SerializedLexicalNode;
}

/** The change between two states, at the level of top-level blocks. */
export interface LexicalBlockDiff {
  /** Every new, changed or moved block, in document order. */
  blocks: LexicalBlockChange[];
  /** Ids of base blocks the edited document no longer has. */
  removed: string[];
}

/** The durable id Macro stores on a serialized node (`$.id`). */
export function serializedNodeId(node: SerializedLexicalNode): string {
  const id = node.$?.id;
  if (typeof id !== 'string' || id === '')
    throw new Error(`Lexical ${node.type} block without an id`);
  return id;
}

/**
 * Diff two serialized states by top-level block id. A block is changed when
 * its JSON differs anywhere inside it, so a nested edit sends the whole block;
 * moved when it is outside the longest common subsequence of the two orders.
 */
export function diffBlocks(
  base: SerializedEditorState,
  edited: SerializedEditorState,
): LexicalBlockDiff {
  const baseBlocks = new Map(
    base.root.children.map((node) => [serializedNodeId(node), node]),
  );
  const editedIds = edited.root.children.map(serializedNodeId);
  const editedSet = new Set(editedIds);
  const kept = longestCommonSubsequence(
    [...baseBlocks.keys()].filter((id) => editedSet.has(id)),
    editedIds.filter((id) => baseBlocks.has(id)),
  );

  const blocks: LexicalBlockChange[] = [];
  edited.root.children.forEach((node, index) => {
    const id = editedIds[index];
    const before = baseBlocks.get(id);
    if (before !== undefined && kept.has(id) && jsonEqual(before, node)) return;
    blocks.push({ id, after: editedIds[index - 1] ?? null, node });
  });
  const removed = [...baseBlocks.keys()].filter((id) => !editedSet.has(id));
  return { blocks, removed };
}

/** Structural equality of JSON values; object key order is irrelevant. */
export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left))
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index]))
    );
  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null ||
    Array.isArray(right)
  )
    return false;
  const leftEntries = Object.entries(left).filter(([, v]) => v !== undefined);
  const rightRecord = new Map(
    Object.entries(right).filter(([, v]) => v !== undefined),
  );
  return (
    leftEntries.length === rightRecord.size &&
    leftEntries.every(
      ([key, value]) =>
        rightRecord.has(key) && jsonEqual(value, rightRecord.get(key)),
    )
  );
}

function longestCommonSubsequence(
  first: string[],
  second: string[],
): Set<string> {
  const lengths = Array.from({ length: first.length + 1 }, () =>
    new Array<number>(second.length + 1).fill(0),
  );
  for (let i = first.length - 1; i >= 0; i--)
    for (let j = second.length - 1; j >= 0; j--)
      lengths[i][j] =
        first[i] === second[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  const common = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < first.length && j < second.length) {
    if (first[i] === second[j]) {
      common.add(first[i]);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  }
  return common;
}
