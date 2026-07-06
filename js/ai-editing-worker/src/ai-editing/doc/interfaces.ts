/**
 * The two views onto the document. `Doc` (doc/doc.ts) implements both over a real
 * Lexical session; the planner (`DocumentOpQueue.step`) is handed only `DocReader`
 * so it can read to plan but never mutate, and the executor is handed `DocWriter`.
 * Mocks of these (with no Lexical) drive the pure tests.
 */
import type { DocumentOp, NodeId, NodeRef, Offset, Scope } from '../editor';

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
  apply(op: DocumentOp): void;
}
