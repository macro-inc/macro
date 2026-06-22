/**
 * The data the queue produces. An op expands into a `DocumentOpAction` — a flat
 * list of `DocumentOpStep`s the executor replays in order: pump an `Awareness`
 * into the AwarenessSource, apply an `Edit` via the DocWriter, or sleep. Edits
 * (Y) are atomic and 1:1 with `DocWriter` methods; awareness (X) is one of two
 * shapes that map straight onto a cursor/selection broadcast.
 */
import type {
  BlockType,
  Format,
  ListKind,
  NodeRef,
  NodeSpec,
  Offset,
  Position,
  Scope,
  Span,
} from '../editor/ops';

/** Awareness payload. */
export type Awareness =
  | { type: 'cursor'; node: NodeRef; at?: Offset }
  | { type: 'highlight'; node: NodeRef; span?: Span };

/** One atomic edit, which is 1:1 with a `DocWriter` method. */
export type Edit =
  | { fn: 'insertText'; node: NodeRef; at: Offset; text: string }
  | { fn: 'removeText'; node: NodeRef; at: Offset; len: number }
  | { fn: 'setText'; node: NodeRef; text: string }
  | { fn: 'appendText'; node: NodeRef; text: string }
  | { fn: 'prependText'; node: NodeRef; text: string }
  | { fn: 'replaceText'; node: NodeRef; find: string; to: string; scope: Scope }
  | { fn: 'formatText'; node: NodeRef; match: string; format: Format; on: boolean; scope: Scope }
  | { fn: 'clearFormat'; node: NodeRef; match?: string; scope: Scope }
  | { fn: 'markText'; node: NodeRef; match: string; on: boolean; scope: Scope }
  | { fn: 'linkText'; node: NodeRef; match: string; url: string | null; scope: Scope }
  | { fn: 'formatNode'; node: NodeRef; format: Format; on: boolean }
  | { fn: 'clearNodeFormat'; node: NodeRef }
  | { fn: 'setBlockType'; node: NodeRef; block: BlockType; level?: number; language?: string }
  | { fn: 'setListType'; nodes: NodeRef[]; list: ListKind }
  | { fn: 'appendListItem'; ref: string; node: NodeRef; checked?: boolean }
  | { fn: 'setChecked'; node: NodeRef; checked: boolean }
  | { fn: 'setIndent'; node: NodeRef; indent: number | 'in' | 'out' }
  | { fn: 'sortList'; node: NodeRef; order: 'asc' | 'desc' }
  | { fn: 'insertNode'; ref: string; spec: NodeSpec; at: Position }
  | { fn: 'insertInline'; ref: string; node: NodeRef; at: Offset; spec: NodeSpec }
  | { fn: 'moveNode'; node: NodeRef; at: Position }
  | { fn: 'removeNode'; node: NodeRef }
  | { fn: 'mergeBlocks'; nodes: NodeRef[]; separator: string }
  | { fn: 'splitBlock'; node: NodeRef; atText: string }
  | { fn: 'setCell'; table: NodeRef; row: number; col: number; text: string }
  | { fn: 'addRow'; table: NodeRef; at?: number }
  | { fn: 'addColumn'; table: NodeRef; at?: number }
  | { fn: 'removeRow'; table: NodeRef; row: number }
  | { fn: 'removeColumn'; table: NodeRef; col: number };

export type DocumentOpStep =
  | { kind: 'awareness'; x: Awareness }
  | { kind: 'edit'; y: Edit }
  | { kind: 'pause'; ms: number };

export type DocumentOpAction = { done: boolean; steps: DocumentOpStep[] };

/**
 * Tunable random ranges, threaded into every animator. Each is `[min, max]`;
 * the `RandomSource` picks within. `highlightSweeps` is the number of incremental
 * drag-select steps before a selection settles (0 = jump straight to the full span).
 */
export type RandomRanges = {
  highlightSweeps: [number, number];
  preSelectPauseMs: [number, number]; // caret rests on the anchor before sweeping
  sweepPauseMs: [number, number];
  settlePauseMs: [number, number];
  preDeletePauseMs: [number, number];
  typeJitter: [number, number]; // multiplier on msPerChar, per keystroke
  betweenNodesPauseMs: [number, number];
};

export const DEFAULT_RANGES: RandomRanges = {
  highlightSweeps: [0, 5],
  // Selecting and deleting read as deliberate, weighty motions — slower than typing.
  preSelectPauseMs: [60, 220],
  sweepPauseMs: [90, 240],
  settlePauseMs: [90, 200],
  preDeletePauseMs: [350, 700],
  typeJitter: [0.6, 1.5],
  betweenNodesPauseMs: [180, 360],
};
