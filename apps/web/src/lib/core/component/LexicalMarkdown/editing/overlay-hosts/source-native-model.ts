import { isDeepStrictEqual } from 'node:util';
import { urlAlphabet } from 'nanoid';

/**
 * The Query-qualified comparison (native-query-callback.test.ts): Source runs
 * with its app wrapper's real node ids, every key and value is compared
 * exactly, and only node `$.id` values are paired through a bijection that
 * persists across the before and after models.
 */
/**
 * A value in its serialized form, as it would be persisted or sent: own keys
 * whose value is undefined are dropped (JSON has no undefined), null is kept.
 * Source's live toJSON can hold such keys (AgentSessionMentionNode.ts:130-140
 * writes mentionUuid as-is), while native's model is already parsed from a
 * serialized string, so both sides are compared in this form.
 */
export function serializedJSON<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value));
}

export type IdPairing = {
  forward: Map<string, string>;
  reverse: Map<string, string>;
};

export function createIdPairing(): IdPairing {
  return { forward: new Map(), reverse: new Map() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Source nodeIdPlugin ids: nanoid(8) over the URL-safe alphabet. */
export function assertNodeId(
  value: unknown,
  at: string
): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${at}: node id missing`);
  if (value.length !== 8 || ![...value].every((c) => urlAlphabet.includes(c)))
    throw new Error(`${at}: node id malformed: ${JSON.stringify(value)}`);
}

/** Every node in the tree carries a well-formed id, unique within the tree. */
export function validateNodeIds(
  nodes: unknown,
  at = 'children',
  seen: Set<string> = new Set()
): void {
  if (!Array.isArray(nodes)) throw new Error(`${at}: node array missing`);
  nodes.forEach((node, index) => {
    const here = `${at}[${index}]`;
    if (!isRecord(node) || !isRecord(node.$))
      throw new Error(`${here}: node id state missing`);
    assertNodeId(node.$.id, here);
    if (seen.has(node.$.id))
      throw new Error(`${here}: duplicate node id ${node.$.id}`);
    seen.add(node.$.id);
    if ('children' in node)
      validateNodeIds(node.children, `${here}.children`, seen);
  });
}

function same(source: unknown, native: unknown, at: string) {
  if (!isDeepStrictEqual(source, native))
    throw new Error(
      `${at}: Source ${JSON.stringify(source)} != native ${JSON.stringify(native)}`
    );
}

function pair(ids: IdPairing, sourceId: string, nativeId: string, at: string) {
  const mapped = ids.forward.get(sourceId);
  if (mapped !== undefined) {
    if (mapped !== nativeId)
      throw new Error(
        `${at}: Source id ${sourceId} was paired with ${mapped}, now ${nativeId}`
      );
    return;
  }
  if (ids.reverse.has(nativeId))
    throw new Error(
      `${at}: native id ${nativeId} was paired with ${ids.reverse.get(nativeId)}, now ${sourceId}`
    );
  ids.forward.set(sourceId, nativeId);
  ids.reverse.set(nativeId, sourceId);
}

/**
 * Compare two node arrays position by position. Each node's own `$.id` goes
 * through the pairing; its other `$` keys, every other field (including any
 * `$`-shaped value inside a field) and its children are compared exactly.
 */
export function compareNodes(
  source: unknown,
  native: unknown,
  ids: IdPairing,
  at = 'children'
): void {
  if (!Array.isArray(source) || !Array.isArray(native))
    throw new Error(`${at}: node array missing`);
  if (source.length !== native.length)
    throw new Error(
      `${at}: ${source.length} Source nodes, ${native.length} native`
    );
  source.forEach((sourceNode, index) => {
    const here = `${at}[${index}]`;
    const nativeNode = native[index];
    if (!isRecord(sourceNode) || !isRecord(nativeNode))
      throw new Error(`${here}: node missing`);
    same(
      Object.keys(sourceNode).sort(),
      Object.keys(nativeNode).sort(),
      `${here} keys`
    );
    for (const key of Object.keys(sourceNode)) {
      if (key === 'children') {
        compareNodes(
          sourceNode.children,
          nativeNode.children,
          ids,
          `${here}.children`
        );
      } else if (key === '$') {
        const sourceState = sourceNode.$;
        const nativeState = nativeNode.$;
        if (!isRecord(sourceState) || !isRecord(nativeState))
          throw new Error(`${here}.$: node id state missing`);
        const { id: sourceId, ...sourceRest } = sourceState;
        const { id: nativeId, ...nativeRest } = nativeState;
        assertNodeId(sourceId, `${here} Source`);
        assertNodeId(nativeId, `${here} native`);
        pair(ids, sourceId, nativeId, here);
        same(sourceRest, nativeRest, `${here}.$`);
      } else same(sourceNode[key], nativeNode[key], `${here}.${key}`);
    }
  });
}

/**
 * The Source root's own state in a phase, as observed: its id ('id'), or no
 * state at all ('absent', after a same-view replacement drops the root id).
 */
export type SourceRootState = 'id' | 'absent';

/**
 * Roots, against an explicit per-phase contract. Source's root state is
 * exactly its own id (validated in one seen set with every child, so a
 * root/child duplicate fails) or exactly absent; native's root state is the
 * expected literal; every other root field is compared exactly; the children
 * go through compareNodes. Native's root does not carry an id yet
 * (C-ROOT-ID-PRESENCE-01, open, fix pending: Source mints one), so root ids
 * are never paired; the native contract changes when that fix lands.
 */
export function compareRoots(
  source: unknown,
  native: unknown,
  contract: { source: SourceRootState; native: unknown },
  ids: IdPairing,
  at = 'root'
): void {
  if (!isRecord(source) || !isRecord(native))
    throw new Error(`${at}: root missing`);
  const { $: sourceState, children: sourceChildren, ...sourceRest } = source;
  const { $: nativeState, children: nativeChildren, ...nativeRest } = native;
  const seen = new Set<string>();
  if (contract.source === 'absent') {
    if ('$' in source)
      throw new Error(
        `${at}: Source root state should be absent, got ${JSON.stringify(sourceState)}`
      );
  } else {
    if (!isRecord(sourceState))
      throw new Error(`${at}: Source root id state missing`);
    same(Object.keys(sourceState), ['id'], `${at} Source root state keys`);
    assertNodeId(sourceState.id, `${at} Source root`);
    seen.add(sourceState.id);
  }
  validateNodeIds(sourceChildren, `${at} Source children`, seen);
  validateNodeIds(nativeChildren, `${at} native children`);
  same(nativeState, contract.native, `${at} native root state`);
  same(sourceRest, nativeRest, `${at} fields`);
  compareNodes(sourceChildren, nativeChildren, ids, `${at}.children`);
}
