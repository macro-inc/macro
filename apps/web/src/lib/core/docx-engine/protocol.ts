/**
 * The messages exchanged with the DOCX engine worker.
 *
 * Requests and responses are correlated by `id`. The worker holds every open
 * document by `docKey` and serves requests strictly in order, so an edit is
 * always applied before a render posted after it.
 */

import type {
  CaretRect,
  Clip,
  DocComment,
  EditResult,
  FindOptions,
  FindResult,
  PageInfo,
  PageRect,
  ParagraphText,
  Pos,
  StyleInfo,
} from './types';

interface Base {
  id: number;
  docKey: string;
}

export type DocxRequest =
  | (Base & { kind: 'open'; bytes: ArrayBuffer })
  /** Opens shared state (`CollabState` JSON); `seed` is unique per peer. */
  | (Base & { kind: 'openCollab'; state: string; seed: number })
  /** Opens a document in the first shared format (`V1State` JSON). */
  | (Base & { kind: 'openV1'; state: string })
  | (Base & { kind: 'collabState' })
  | (Base & { kind: 'close' })
  | (Base & { kind: 'apply'; ops: string; group?: string })
  | (Base & { kind: 'applyRemote'; changes: string })
  | (Base & { kind: 'state' })
  | (Base & { kind: 'setMarkup'; markup: boolean })
  | (Base & { kind: 'setExternalUndo'; external: boolean })
  | (Base & { kind: 'setAuthor'; author: string })
  | (Base & { kind: 'breakGroup' })
  | (Base & { kind: 'undo' })
  | (Base & { kind: 'redo' })
  | (Base & { kind: 'render'; page: number; width: number })
  | (Base & {
      kind: 'renderBand';
      page: number;
      width: number;
      top: number;
      bottom: number;
    })
  | (Base & { kind: 'hitTest'; page: number; x: number; y: number })
  | (Base & { kind: 'caretAt'; pos: Pos })
  | (Base & { kind: 'rangeRects'; from: Pos; to: Pos })
  | (Base & { kind: 'selectedText' })
  | (Base & { kind: 'copySelection' })
  | (Base & { kind: 'find'; query: string; options: FindOptions })
  | (Base & { kind: 'paragraphs' })
  | (Base & { kind: 'documentComments' })
  | (Base & { kind: 'styles' })
  | (Base & { kind: 'save' });

export type DocxResponse =
  | { id: number; ok: true; kind: 'open'; pages: PageInfo[]; state: EditResult }
  | { id: number; ok: true; kind: 'close' }
  | { id: number; ok: true; kind: 'collabState'; state: string }
  | { id: number; ok: true; kind: 'edit'; result: EditResult | null }
  | {
      id: number;
      ok: true;
      kind: 'render';
      bitmap: ImageBitmap;
      millis: number;
    }
  | { id: number; ok: true; kind: 'pos'; pos: Pos | null }
  | { id: number; ok: true; kind: 'caret'; caret: CaretRect | null }
  | { id: number; ok: true; kind: 'rects'; rects: PageRect[] }
  | { id: number; ok: true; kind: 'text'; text: string }
  | { id: number; ok: true; kind: 'clip'; clip: Clip }
  | { id: number; ok: true; kind: 'find'; result: FindResult }
  | { id: number; ok: true; kind: 'paragraphs'; paragraphs: ParagraphText[] }
  | { id: number; ok: true; kind: 'comments'; comments: DocComment[] }
  | { id: number; ok: true; kind: 'styles'; styles: StyleInfo[] }
  | { id: number; ok: true; kind: 'save'; bytes: ArrayBuffer }
  | { id: number; ok: true; kind: 'done' }
  | { id: number; ok: false; error: string };
