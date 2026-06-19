/**
 * Keyed tree diff over two serialized editor states.
 *
 * The nodeId plugin stamps every node with a stable id (serialized at `node.$.id`),
 * so matching a node across `before` and `after` is a hashmap lookup rather than
 * the correspondence-inference that makes general tree-diff expensive. That turns
 * the whole diff into a linear keyed reconciliation: set-difference for adds/deletes,
 * field comparison for the rest.
 *
 * Pure JSON-in / JSON-out — no editor, no Loro, no clock. This is the load-bearing
 * piece for human-like replay; the replay/awareness layers consume `Change[]` later.
 */

import type { SerializedEditorState } from 'lexical';

/** A serialized node as it appears in a snapshot (loosely typed). */
type RawNode = {
  type: string;
  text?: string;
  children?: RawNode[];
  $?: { id?: string };
  [field: string]: unknown;
};

export type Change =
  | { kind: 'insert'; id: string; type: string; parentId: string | null; afterId: string | null }
  | { kind: 'delete'; id: string; type: string }
  | { kind: 'move'; id: string; type: string; parentId: string | null; afterId: string | null }
  | { kind: 'setText'; id: string; type: string; from: string; to: string }
  | {
      kind: 'setAttrs';
      id: string;
      type: string;
      changed: Record<string, { from: unknown; to: unknown }>;
    };

const ROOT_ID = 'root';

/** Fields that aren't semantic content — excluded from attr comparison. */
const SKIP_ATTRS = new Set(['children', '$', 'text', 'type', 'version', 'direction']);

type FlatNode = {
  id: string;
  type: string;
  parentId: string | null;
  /** Previous id-bearing sibling, or null if first. Position is neighbor-relative. */
  prevId: string | null;
  /** Pre-order document position. */
  order: number;
  text?: string;
  attrs: Record<string, unknown>;
};

function ownAttrs(node: RawNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(node)) {
    if (!SKIP_ATTRS.has(k)) out[k] = node[k];
  }
  return out;
}

/** Flatten a snapshot into an id → node map, capturing position and content. */
function flatten(state: SerializedEditorState): Map<string, FlatNode> {
  const map = new Map<string, FlatNode>();
  const root = (state as unknown as { root: RawNode }).root;
  let order = 0;

  map.set(ROOT_ID, {
    id: ROOT_ID,
    type: 'root',
    parentId: null,
    prevId: null,
    order: order++,
    attrs: {},
  });

  // `prevId` is closure state shared across a sibling group; an id-less node is
  // transparent (its children attach to the same parent and continue the chain).
  const visit = (children: RawNode[] | undefined, parentId: string) => {
    let prevId: string | null = null;
    const walk = (nodes: RawNode[] | undefined) => {
      for (const child of nodes ?? []) {
        const id = child?.$?.id;
        if (typeof id === 'string') {
          map.set(id, {
            id,
            type: child.type,
            parentId,
            prevId,
            order: order++,
            text: typeof child.text === 'string' ? child.text : undefined,
            attrs: ownAttrs(child),
          });
          prevId = id;
          visit(child.children, id);
        } else {
          walk(child?.children);
        }
      }
    };
    walk(children);
  };

  visit(root.children, ROOT_ID);
  return map;
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffAttrs(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!eq(a[k], b[k])) changed[k] = { from: a[k], to: b[k] };
  }
  return changed;
}

/**
 * Diff two snapshots into a flat, document-ordered change list. A single node may
 * yield several changes (e.g. it both moved and had its text edited).
 */
export function diffTrees(
  before: SerializedEditorState,
  after: SerializedEditorState
): Change[] {
  const A = flatten(before);
  const B = flatten(after);
  const changes: Change[] = [];

  for (const [id, a] of A) {
    if (id !== ROOT_ID && !B.has(id)) {
      changes.push({ kind: 'delete', id, type: a.type });
    }
  }

  for (const [id, b] of B) {
    if (id === ROOT_ID) continue;
    const a = A.get(id);

    if (!a) {
      changes.push({ kind: 'insert', id, type: b.type, parentId: b.parentId, afterId: b.prevId });
      continue;
    }

    if (a.parentId !== b.parentId || a.prevId !== b.prevId) {
      changes.push({ kind: 'move', id, type: b.type, parentId: b.parentId, afterId: b.prevId });
    }
    if (b.text !== undefined && a.text !== b.text) {
      changes.push({ kind: 'setText', id, type: b.type, from: a.text ?? '', to: b.text });
    }
    const attrs = diffAttrs(a.attrs, b.attrs);
    if (a.type !== b.type) attrs.type = { from: a.type, to: b.type };
    if (Object.keys(attrs).length > 0) {
      changes.push({ kind: 'setAttrs', id, type: b.type, changed: attrs });
    }
  }

  const orderOf = (c: Change) =>
    c.kind === 'delete' ? (A.get(c.id)?.order ?? 0) : (B.get(c.id)?.order ?? 0);
  // Stable sort keeps a node's move→text→attrs in the order pushed above.
  return changes
    .map((c, i) => [c, i] as const)
    .sort(([x, i], [y, j]) => orderOf(x) - orderOf(y) || i - j)
    .map(([c]) => c);
}

// ── printers (harness observability) ───────────────────────────────────────

function trunc(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Render a snapshot as an indented `type#id "text"` outline. */
export function printTree(state: SerializedEditorState): string {
  const root = (state as unknown as { root: RawNode }).root;
  const lines = ['root'];
  const walk = (node: RawNode, depth: number) => {
    const id = node?.$?.id;
    const tag = id ? `#${id}` : '';
    const text = typeof node.text === 'string' ? ` ${JSON.stringify(trunc(node.text))}` : '';
    lines.push(`${'  '.repeat(depth)}${node.type}${tag}${text}`);
    for (const c of node.children ?? []) walk(c, depth + 1);
  };
  for (const c of root.children ?? []) walk(c, 1);
  return lines.join('\n');
}

function formatChange(c: Change): string {
  switch (c.kind) {
    case 'insert':
      return `+ insert ${c.type}#${c.id}  after ${c.afterId ?? '(start)'} in ${c.parentId}`;
    case 'delete':
      return `- delete ${c.type}#${c.id}`;
    case 'move':
      return `~ move   ${c.type}#${c.id}  → after ${c.afterId ?? '(start)'} in ${c.parentId}`;
    case 'setText':
      return `~ text   #${c.id}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`;
    case 'setAttrs': {
      const fields = Object.entries(c.changed)
        .map(([k, v]) => `${k} ${JSON.stringify(v.from)}→${JSON.stringify(v.to)}`)
        .join(', ');
      return `~ attrs  #${c.id}: ${fields}`;
    }
  }
}

export function printChanges(changes: Change[]): string {
  if (changes.length === 0) return '(no changes)';
  return changes.map(formatChange).join('\n');
}
