import type { SerializedLexicalNode } from 'lexical';

/** One inline run within a modified block (character-level). */
export interface WordRun {
  op: 'keep' | 'insert' | 'delete';
  text: string;
}

// Stands in for a genuine `linebreak` node when a block is flattened to text for
// diffing. Text content is passed through verbatim, so a literal "\n" a user
// typed never collides with this — the ¶ marker only ever represents a real
// linebreak node.
export const NEWLINE = '\n';

interface DiffBase {
  /** The stable `$.id` of the node this diff is anchored to. */
  node_id: string;
  /** Who made this change (drives author coloring). */
  author?: string;
}

/** A whole new block inserted relative to the anchor node. */
export interface InsertDiff extends DiffBase {
  operation: 'INSERT_BEFORE' | 'INSERT_AFTER';
  /** The actual after-block node to insert. */
  node: SerializedLexicalNode;
}

/** An edited block, rendered as character-level inline runs. */
export interface ModifyDiff extends DiffBase {
  operation: 'MODIFY';
  runs: WordRun[];
}

/** A removed block. */
export interface DeleteDiff extends DiffBase {
  operation: 'DELETE';
}

export type Diff = InsertDiff | ModifyDiff | DeleteDiff;
