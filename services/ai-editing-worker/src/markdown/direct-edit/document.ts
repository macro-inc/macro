/**
 * A markdown document as the direct-edit engine sees it: its top-level blocks,
 * each with its durable id and its internal markdown rendered alone (the same
 * render `/markdown` and the block diff use).
 */
import { $convertToMarkdownString } from '@lexical/markdown';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { INTERNAL_TRANSFORMERS } from '@macro-inc/lexical-core/transformers';
import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';
import { LoroDoc } from 'loro-crdt';
import {
  createEditingSession,
  loadMarkdown,
  toSnapshot,
} from '../../ai-editing/ai-toolkit/session';
import { blockMarkdown, sessionFromSnapshot } from '../body';

/** A serialized Lexical node with the fields the engine reads. */
export type SerializedNode = SerializedLexicalNode & {
  children?: SerializedNode[];
  text?: string;
  format?: number | string;
  $?: { id?: string; [key: string]: unknown };
  [key: string]: unknown;
};

export interface DocumentBlock {
  /** Durable node id of the top-level block (`$.id`). */
  id: string;
  /** Lexical node type: paragraph, heading, list, table… */
  type: string;
  /** Internal markdown of this block rendered alone. */
  markdown: string;
  /**
   * Markdown cannot carry this block (parsing its markdown does not give it
   * back), so it is shown as a keep placeholder and can only move or go.
   */
  opaque: boolean;
  /** Comment-mark ids inside this block. */
  commentIds: string[];
  /** Ids of every node in this block, the block included. */
  nodeIds: string[];
}

export interface DocumentView {
  blocks: DocumentBlock[];
  /** The serialized top-level nodes, index-aligned with `blocks`. */
  nodes: SerializedNode[];
}

export function walk(node: SerializedNode, visit: (n: SerializedNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function nodeIdsOf(node: SerializedNode): string[] {
  const ids: string[] = [];
  walk(node, (n) => {
    if (typeof n.$?.id === 'string') ids.push(n.$.id);
  });
  return ids;
}

function commentIdsOf(node: SerializedNode): string[] {
  const ids: string[] = [];
  walk(node, (n) => {
    if (n.type === 'comment-mark' && Array.isArray(n.ids))
      for (const id of n.ids) ids.push(String(id));
  });
  return ids;
}

/** Text of every text-bearing node, for markup-leak scans. */
export function textsOf(nodes: SerializedNode[]): string[] {
  const texts: string[] = [];
  for (const node of nodes)
    walk(node, (n) => {
      if (typeof n.text === 'string') texts.push(n.text);
    });
  return texts;
}

/** Node types that do not count toward a block's shape. */
const SHAPE_TRANSPARENT = new Set(['text', 'code-highlight', 'comment-mark']);

function shape(node: SerializedNode): string {
  const types: string[] = [];
  walk(node, (n) => {
    if (!SHAPE_TRANSPARENT.has(n.type)) types.push(n.type);
  });
  return types.join(',');
}

/** Parse internal markdown into top-level serialized blocks and their renders. */
export function parseMarkdown(
  markdown: string,
  session = createEditingSession()
): {
  nodes: SerializedNode[];
  markdowns: string[];
} {
  loadMarkdown(session, markdown);
  const nodes = toSnapshot(session).root.children as SerializedNode[];
  return { nodes, markdowns: blockMarkdown(nodes, session) };
}

/**
 * Whether each block is opaque, by its markdown and shape. One request reads
 * the same blocks several times (current, base, merged, after), so it shares
 * one; it lives only as long as the request.
 */
export type OpacityCache = Map<string, boolean>;

function isOpaque(
  node: SerializedNode,
  markdown: string,
  scratch: ReturnType<typeof createEditingSession>,
  cache: OpacityCache
): boolean {
  const key = `${shape(node)}\u0000${markdown}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  let opaque: boolean;
  try {
    const parsed = parseMarkdown(markdown, scratch);
    opaque =
      parsed.nodes.length !== 1 ||
      parsed.markdowns[0] !== markdown ||
      shape(parsed.nodes[0]) !== shape(node);
  } catch {
    opaque = true;
  }
  cache.set(key, opaque);
  return opaque;
}

/** Read a Loro snapshot as top-level blocks. */
export async function readDocument(
  documentId: string,
  snapshot: Uint8Array,
  opacity: OpacityCache = new Map()
): Promise<DocumentView> {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  try {
    const session = await sessionFromSnapshot(manager, snapshot);
    return viewOf(toSnapshot(session), opacity);
  } finally {
    manager.dispose();
  }
}

/** Prefix of the id a block without a stored id gets: its position. */
export const POSITIONAL_ID_PREFIX = 'index-';

export function viewOf(
  state: SerializedEditorState,
  opacity: OpacityCache = new Map()
): DocumentView {
  const nodes = state.root.children as SerializedNode[];
  const scratch = createEditingSession();
  const markdowns = blockMarkdown(nodes, scratch);
  const blocks = nodes.map((node, i) => ({
    id: String(node.$?.id ?? `${POSITIONAL_ID_PREFIX}${i}`),
    type: node.type,
    markdown: markdowns[i],
    opaque: isOpaque(node, markdowns[i], scratch, opacity),
    commentIds: commentIdsOf(node),
    nodeIds: nodeIdsOf(node),
  }));
  return { blocks, nodes };
}

/** Whole-document internal markdown, as `/markdown` reads it. */
export function renderMarkdown(nodes: SerializedNode[]): string {
  const session = createEditingSession();
  session.editor.setEditorState(
    session.editor.parseEditorState({
      root: {
        type: 'root',
        version: 1,
        direction: null,
        format: '',
        indent: 0,
        children: nodes,
      },
    } as SerializedEditorState)
  );
  return session.editor.read(() =>
    $convertToMarkdownString(INTERNAL_TRANSFORMERS)
  );
}

/** Apply a Loro update to a snapshot and export the full resulting snapshot. */
export function applyUpdate(
  snapshot: Uint8Array,
  update: Uint8Array
): Uint8Array {
  const doc = new LoroDoc();
  doc.import(snapshot);
  doc.import(update);
  return doc.export({ mode: 'snapshot' });
}

/**
 * Markdown for read-back comparisons: `"key":null` inside `<m-…>` tag JSON is
 * dropped (text outside tags compares exactly),
 * because a Loro round trip materialises absent optional fields as null (a new
 * document card gains `"mentionUuid":null`) with no visible change.
 */
export function verifyKey(markdown: string): string {
  return markdown.replace(
    /(<m-[a-z-]+>)(\{[\s\S]*?\})(<\/m-[a-z-]+>)/g,
    (_, open: string, json: string, close: string) =>
      open +
      json.replace(/"[A-Za-z_][A-Za-z0-9_]*":null,?/g, '').replace(/,}/g, '}') +
      close
  );
}

/** The placeholder an opaque block is shown as; it must be left as it is. */
export function keepPlaceholder(id: string): string {
  return `<!-- keep:${id} -->`;
}
