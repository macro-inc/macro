/**
 * The data the queue produces. An op expands into a `DocumentOpAction` — a flat
 * list of `DocumentOpStep`s the executor replays in order: pump an `Awareness`
 * into the AwarenessSource, apply a `DocumentOp` via the DocWriter, or sleep.
 */
import type { DocumentOp, NodeRef, Offset, Span } from '../editor';

/** Awareness payload. */
export type Awareness =
  | { type: 'cursor'; node: NodeRef; at?: Offset }
  | { type: 'highlight'; node: NodeRef; span?: Span };

export type DocumentOpStep =
  | { kind: 'awareness'; x: Awareness }
  | { kind: 'edit'; y: DocumentOp }
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

export type DocumentOpQueueParams = {
  speed: number;
  ranges: RandomRanges;
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

export const DEFAULT_QUEUE_PARAMS: DocumentOpQueueParams = {
  speed: 1200,
  ranges: DEFAULT_RANGES,
};
