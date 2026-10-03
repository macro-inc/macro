/**
 * The messages exchanged with the PPTX engine worker.
 *
 * Requests and responses are correlated by `id`. The worker holds every open
 * document by `docKey` and serves requests strictly in order, so an edit is
 * always applied before a render posted after it.
 */

import type {
  DeckOutline,
  EditResult,
  EntryChange,
  SlideOutline,
  TextLayoutInfo,
} from './types';

interface Base {
  id: number;
  docKey: string;
}

export type PptxRequest =
  | (Base & { kind: 'open'; bytes: ArrayBuffer })
  /** Opens shared collaborative entries (`CollabEntries` JSON). */
  | (Base & { kind: 'openEntries'; entries: string; seed: number })
  /** Starts collaborative editing of an opened file; answers every entry. */
  | (Base & { kind: 'enableCollab'; seed: number })
  /** Applies shared-map changes (`EntryChange[]` JSON) made elsewhere. */
  | (Base & { kind: 'applyCollab'; changes: string })
  | (Base & { kind: 'close' })
  | (Base & { kind: 'outline' })
  | (Base & { kind: 'slideOutline'; index: number })
  | (Base & { kind: 'render'; index: number; width: number })
  | (Base & {
      kind: 'renderLayer';
      index: number;
      width: number;
      mode: 'without' | 'only';
      shape: number;
    })
  | (Base & { kind: 'textLayout'; index: number; shape: number })
  | (Base & { kind: 'apply'; ops: string; group?: string })
  | (Base & { kind: 'breakGroup' })
  | (Base & { kind: 'undo' })
  | (Base & { kind: 'redo' })
  | (Base & { kind: 'save' });

/** History availability, reported after every state change. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

export type PptxResponse =
  | {
      id: number;
      ok: true;
      kind: 'open';
      slideCount: number;
      size: [number, number];
    }
  | { id: number; ok: true; kind: 'close' }
  | { id: number; ok: true; kind: 'outline'; outline: DeckOutline }
  | { id: number; ok: true; kind: 'slideOutline'; slide: SlideOutline }
  | {
      id: number;
      ok: true;
      kind: 'render';
      bitmap: ImageBitmap;
      millis: number;
    }
  | { id: number; ok: true; kind: 'textLayout'; layout: TextLayoutInfo | null }
  | {
      id: number;
      ok: true;
      kind: 'edit';
      result: EditResult | null;
      history: HistoryState;
      /** For a collaborative presentation, the shared-map changes owed. */
      changes?: EntryChange[];
    }
  | { id: number; ok: true; kind: 'collab'; changes: EntryChange[] }
  | { id: number; ok: true; kind: 'save'; bytes: ArrayBuffer }
  | { id: number; ok: false; error: string };
