import { createDocumentEditor } from '@macro-inc/lexical-core/sdk';
import type { LexicalEditor, SerializedEditorState } from 'lexical';

/** A serialized Lexical node: its type, attributes, `$` node state and children. */
export type SerializedNode = {
  type: string;
  children?: SerializedNode[];
  $?: { id?: unknown; [key: string]: unknown };
  [key: string]: unknown;
};

/** A serialized Lexical editor state. */
export type SerializedState = { root: SerializedNode };

let documentEditor: LexicalEditor | undefined;

/**
 * Round-trip `state` through a headless editor holding every document node, so
 * states from the Loro mirror, the live session and a program compare
 * structurally. Throws on node types the document doesn't support.
 */
export function normalizeState(state: unknown): SerializedState {
  documentEditor ??= createDocumentEditor();
  const parsed = documentEditor.parseEditorState(
    withRoot(state) as unknown as SerializedEditorState
  );
  return parsed.toJSON() as unknown as SerializedState;
}

/** A version before anything was written has a root without children. */
function withRoot(state: unknown): unknown {
  const root = isRecord(state) ? state.root : undefined;
  if (isRecord(root) && Array.isArray(root.children)) return state;
  return {
    root: {
      type: 'root',
      children: [],
      direction: null,
      format: '',
      indent: 0,
      version: 1,
    },
  };
}

/** The node's durable id, from its `$` node state. */
export function nodeId(node: SerializedNode): string | null {
  const id = node.$?.id;
  return typeof id === 'string' ? id : null;
}

/**
 * Structural equality of two normalized nodes, ignoring key order. A list
 * item's `value` is its position in the list, recomputed by Lexical whenever
 * a sibling moves, so it is not compared.
 */
export function sameNode(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameNode(item, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right) || Array.isArray(right)) return false;
  const ignored = left.type === 'listitem' ? 'value' : undefined;
  const leftKeys = Object.keys(left).filter(
    (key) => key !== ignored && left[key] !== undefined
  );
  const rightKeys = Object.keys(right).filter(
    (key) => key !== ignored && right[key] !== undefined
  );
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => key in right && sameNode(left[key], right[key]))
  );
}

/**
 * Ids that appear more than once in the tree under `node`, leaving out those
 * inside a duplicated node: a subtree held twice repeats every id in it.
 */
export function duplicateIds(node: SerializedNode): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const count = (current: SerializedNode) => {
    const id = nodeId(current);
    if (id !== null) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    for (const child of current.children ?? []) count(child);
  };
  count(node);
  const outermost = new Set<string>();
  const collect = (current: SerializedNode) => {
    const id = nodeId(current);
    if (id !== null && duplicates.has(id)) {
      outermost.add(id);
      return;
    }
    for (const child of current.children ?? []) collect(child);
  };
  collect(node);
  return [...outermost];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
