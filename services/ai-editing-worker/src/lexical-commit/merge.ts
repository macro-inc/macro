import {
  duplicateIds,
  nodeId,
  type SerializedNode,
  type SerializedState,
  sameNode,
} from './normalize';

export type ConflictReason = 'changed' | 'removed' | 'moved';

export type Conflict = { id: string | null; reason: ConflictReason };

export type MergeOutcome =
  | { conflicts: Conflict[] }
  | {
      state: SerializedState;
      /** Whether the merged state differs from live, i.e. there is anything to apply. */
      changed: boolean;
    };

const CONTAINER_TYPES = new Set([
  'root',
  'list',
  'task-list',
  'table',
  'tablerow',
  'tablecell',
]);
const LIST_TYPES = new Set(['list', 'task-list']);

/**
 * Three-way merge of normalized states, keyed by node id: `base` is the
 * revision the program read, `live` the document now, `wanted` the program's
 * edit of `base`. Containers merge child by child; every other node is
 * compared whole. Any conflict rejects the whole merge.
 */
export function mergeStates(
  base: SerializedState,
  live: SerializedState,
  wanted: SerializedState
): MergeOutcome {
  const conflicts: Conflict[] = [];
  const root = mergeNode(base.root, live.root, wanted.root, conflicts);
  if (conflicts.length > 0) return { conflicts };
  // Moved into different containers by each side, a node survives in both.
  const duplicates = duplicateIds(root);
  if (duplicates.length > 0)
    return {
      conflicts: duplicates.map((id) => ({ id, reason: 'moved' as const })),
    };
  return { state: { root }, changed: !sameNode(root, live.root) };
}

/** Root, lists, tables, rows and cells, and a list item that only holds lists. */
function isContainer(node: SerializedNode): boolean {
  const children = node.children;
  if (!children?.every((child) => nodeId(child) !== null)) return false;
  if (CONTAINER_TYPES.has(node.type)) return true;
  return (
    node.type === 'listitem' &&
    children.length > 0 &&
    children.every((child) => LIST_TYPES.has(child.type))
  );
}

function mergeNode(
  base: SerializedNode,
  live: SerializedNode,
  wanted: SerializedNode,
  conflicts: Conflict[]
): SerializedNode {
  const mergeable =
    base.type === live.type &&
    live.type === wanted.type &&
    isContainer(base) &&
    isContainer(live) &&
    isContainer(wanted);
  if (!mergeable) {
    const merged = pick(base, live, wanted);
    if (merged === undefined) {
      conflicts.push({ id: nodeId(live), reason: 'changed' });
      return live;
    }
    return merged;
  }
  let attributes = pick(
    attributesOf(base),
    attributesOf(live),
    attributesOf(wanted)
  );
  if (attributes === undefined) {
    conflicts.push({ id: nodeId(live), reason: 'changed' });
    attributes = attributesOf(live);
  }
  const children = mergeChildren(
    base.children ?? [],
    live.children ?? [],
    wanted.children ?? [],
    conflicts
  );
  const merged = { ...attributes, children };
  return LIST_TYPES.has(merged.type) ? renumbered(merged) : merged;
}

/** The four-row rule; `undefined` is a conflict. */
function pick<Value>(
  base: Value,
  live: Value,
  wanted: Value
): Value | undefined {
  if (sameNode(wanted, base)) return live;
  if (sameNode(live, base)) return wanted;
  if (sameNode(live, wanted)) return live;
  return undefined;
}

function attributesOf(node: SerializedNode): SerializedNode {
  const { children: _children, ...attributes } = node;
  return attributes;
}

function mergeChildren(
  base: SerializedNode[],
  live: SerializedNode[],
  wanted: SerializedNode[],
  conflicts: Conflict[]
): SerializedNode[] {
  const baseById = byId(base);
  const liveById = byId(live);
  const wantedById = byId(wanted);
  const liveOrder = [...liveById.keys()];
  const wantedOrder = [...wantedById.keys()];
  const result = new Map<string, SerializedNode>();

  for (const [id, liveNode] of liveById) {
    const baseNode = baseById.get(id);
    const wantedNode = wantedById.get(id);
    if (baseNode && wantedNode) {
      result.set(id, mergeNode(baseNode, liveNode, wantedNode, conflicts));
    } else if (baseNode) {
      // The program removed it.
      if (!sameNode(liveNode, baseNode))
        conflicts.push({ id, reason: 'changed' });
    } else if (!wantedNode || sameNode(liveNode, wantedNode)) {
      result.set(id, liveNode);
    } else {
      conflicts.push({ id, reason: 'changed' });
    }
  }
  for (const [id, wantedNode] of wantedById) {
    if (liveById.has(id)) continue;
    const baseNode = baseById.get(id);
    if (!baseNode) result.set(id, wantedNode);
    else if (!sameNode(wantedNode, baseNode))
      conflicts.push({ id, reason: 'removed' });
  }

  const baseOrder = [...baseById.keys()];
  const movedByLive = movedIds(baseOrder, liveOrder);
  const movedByProgram = movedIds(baseOrder, wantedOrder);
  for (const id of movedByProgram) {
    if (!movedByLive.has(id)) continue;
    if (
      basePredecessor(liveOrder, id, baseById) !==
      basePredecessor(wantedOrder, id, baseById)
    )
      conflicts.push({ id, reason: 'moved' });
  }

  const order = liveOrder.filter((id) => result.has(id));
  for (const [index, id] of wantedOrder.entries()) {
    if (!result.has(id)) continue;
    const inserted = !baseById.has(id) && !liveById.has(id);
    if (!inserted && !movedByProgram.has(id)) continue;
    const current = order.indexOf(id);
    if (current !== -1) order.splice(current, 1);
    let predecessor = -1;
    for (let previous = index - 1; previous >= 0; previous--) {
      predecessor = order.indexOf(wantedOrder[previous]!);
      if (predecessor !== -1) break;
    }
    order.splice(predecessor + 1, 0, id);
  }
  return order.map((id) => result.get(id)!);
}

function byId(nodes: SerializedNode[]): Map<string, SerializedNode> {
  return new Map(nodes.map((node) => [nodeId(node)!, node]));
}

/** The nearest earlier sibling in `order` that is also in base, or null. */
function basePredecessor(
  order: string[],
  id: string,
  baseById: Map<string, SerializedNode>
): string | null {
  for (let index = order.indexOf(id) - 1; index >= 0; index--) {
    const candidate = order[index]!;
    if (baseById.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Ids in both orders but outside their longest common subsequence. Ids are
 * unique, so that is the longest increasing run of base positions taken in
 * `side`'s order.
 */
function movedIds(baseOrder: string[], side: string[]): Set<string> {
  const basePosition = new Map(baseOrder.map((id, index) => [id, index]));
  const common = side.filter((id) => basePosition.has(id));
  const positions = common.map((id) => basePosition.get(id)!);
  // Patience sorting: `tails[length]` ends the best run of `length + 1`.
  const tails: number[] = [];
  const previous = new Array<number>(positions.length).fill(-1);
  for (const [index, position] of positions.entries()) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (positions[tails[middle]!]! < position) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  }
  const kept = new Set<string>();
  for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index]!)
    kept.add(common[index]!);
  return new Set(common.filter((id) => !kept.has(id)));
}

/** Number a list's items as Lexical does; an item holding a nested list takes no number. */
function renumbered(list: SerializedNode): SerializedNode {
  let value = typeof list.start === 'number' ? list.start : 1;
  const children = (list.children ?? []).map((child) => {
    if (child.type !== 'listitem') return child;
    const numbered = child.value === value ? child : { ...child, value };
    if (!LIST_TYPES.has(child.children?.[0]?.type ?? '')) value++;
    return numbered;
  });
  return { ...list, children };
}
