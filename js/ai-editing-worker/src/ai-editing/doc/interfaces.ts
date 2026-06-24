/**
 * The two views onto the document. `Doc` (doc/doc.ts) implements both over a real
 * Lexical session; the planner (`DocumentOpQueue.step`) is handed only `DocReader`
 * so it can read to plan but never mutate, and the executor is handed `DocWriter`.
 * Mocks of these (with no Lexical) drive the pure tests.
 */
import type {
  BlockType,
  Format,
  ListKind,
  NodeId,
  NodeRef,
  NodeSpec,
  Offset,
  Position,
  Scope,
} from '../editor/ops';

/** One located occurrence of a substring: the text node holding it and the span. */
export type Match = { node: NodeRef; start: Offset; end: Offset };

export interface DocReader {
  /** Every occurrence of `match` within block `id` (honoring `scope`), as text
   *  node + offsets — used to animate per-occurrence selection. */
  locate(id: NodeId, match: string, scope?: Scope): Match[];
  /** Length of a node's plain-text content (block id or text-node id). */
  textLength(node: NodeRef): number;
  /** The content block node of a table cell (header is row 0). */
  cellNode(table: NodeId, row: number, col: number): NodeRef;
}

export interface DocWriter {
  insertText(node: NodeRef, at: Offset, text: string): void;
  removeText(node: NodeRef, at: Offset, len: number): void;
  setText(node: NodeRef, text: string): void;
  appendText(node: NodeRef, text: string): void;
  prependText(node: NodeRef, text: string): void;
  replaceText(node: NodeRef, find: string, to: string, scope: Scope): void;
  formatText(
    node: NodeRef,
    match: string,
    format: Format,
    on: boolean,
    scope: Scope
  ): void;
  clearFormat(node: NodeRef, match: string | undefined, scope: Scope): void;
  markText(node: NodeRef, match: string, on: boolean, scope: Scope): void;
  linkText(
    node: NodeRef,
    match: string,
    url: string | null,
    scope: Scope
  ): void;
  formatNode(node: NodeRef, format: Format, on: boolean): void;
  clearNodeFormat(node: NodeRef): void;
  setBlockType(
    node: NodeRef,
    block: BlockType,
    opts: { level?: number; language?: string }
  ): void;
  setEquation(node: NodeRef, tex: string): void;
  setListType(nodes: NodeRef[], list: ListKind): void;
  /** Append an empty list item to `node` (a list) and bind `ref` to it, so the
   *  animator can type into each item one at a time (the simulated Enter). */
  appendListItem(ref: string, node: NodeRef, checked?: boolean): void;
  setChecked(node: NodeRef, checked: boolean): void;
  setIndent(node: NodeRef, indent: number | 'in' | 'out'): void;
  sortList(node: NodeRef, order: 'asc' | 'desc'): void;
  insertNode(ref: string, spec: NodeSpec, at: Position): void;
  insertInline(ref: string, node: NodeRef, at: Offset, spec: NodeSpec): void;
  moveNode(node: NodeRef, at: Position): void;
  removeNode(node: NodeRef): void;
  mergeBlocks(nodes: NodeRef[], separator: string): void;
  splitBlock(node: NodeRef, atText: string): void;
  insertListItemAfter(
    ref: string,
    node: NodeRef,
    text: string,
    list: ListKind
  ): void;
  insertListItemBefore(
    ref: string,
    node: NodeRef,
    text: string,
    list: ListKind
  ): void;
  removeListItem(node: NodeRef): void;
  setCell(table: NodeRef, row: number, col: number, text: string): void;
  addRow(table: NodeRef, at?: number): void;
  addColumn(table: NodeRef, at?: number): void;
  removeRow(table: NodeRef, row: number): void;
  removeColumn(table: NodeRef, col: number): void;
  setImageAlt(node: NodeRef, alt: string): void;
  setImageUrl(node: NodeRef, url: string): void;
  setVideoUrl(node: NodeRef, url: string): void;
  setVideoControls(node: NodeRef, controls: boolean): void;
  setDate(node: NodeRef, date: string, displayFormat?: string): void;
}
