/**
 * Messages exchanged with a Photoshop engine worker.
 *
 * Requests are correlated by `id`. A worker hosts one document. Every
 * request other than a render (queries, edits, selections) is served in
 * arrival order before queued renders, so the UI stays responsive while
 * tiles composite and a render always shows the edits sent before it.
 * Queued renders can be cancelled when the view moves on.
 */

import type { Summary } from './types';

/** Engine methods answered with JSON. */
export type QueryMethod =
  | 'summary'
  | 'warnings'
  | 'layers'
  | 'layerInfo'
  | 'hitTest'
  | 'selectionInfo'
  | 'fonts'
  | 'describe'
  | 'isEdited'
  | 'fileLayers';

/** Engine methods answered with bytes (PNG, JPEG, or samples). */
export type BytesMethod =
  | 'thumbnail'
  | 'maskThumbnail'
  | 'preview'
  | 'copyPixels'
  | 'exportPng'
  | 'exportJpeg'
  | 'sample';

export type PsdRequest =
  | { id: number; kind: 'open'; bytes: ArrayBuffer }
  | { id: number; kind: 'blank'; width: number; height: number; white: boolean }
  | {
      id: number;
      kind: 'render';
      /** Pixels of the canvas scaled by `1/2^level`. */
      x: number;
      y: number;
      level: number;
      width: number;
      height: number;
      /** Lower renders first. */
      priority: number;
    }
  | { id: number; kind: 'cancel'; ids: number[] }
  | {
      id: number;
      kind: 'query';
      method: QueryMethod;
      args: (number | null)[];
    }
  | {
      id: number;
      kind: 'bytes';
      method: BytesMethod;
      args: (number | null)[];
    }
  | {
      id: number;
      kind: 'edit';
      /** `remote`: other people's changes (outside the undo history). */
      action: 'apply' | 'undo' | 'redo' | 'remote';
      /** `Op[]` JSON, for `apply`. */
      ops?: string;
      /** Steps with the same key in a row undo as one (a stroke). */
      coalesce?: string;
      /** `EntryChange[]` JSON, for `remote`. */
      changes?: string;
    }
  | { id: number; kind: 'select'; spec: string }
  | {
      id: number;
      kind: 'placeImage';
      bytes: ArrayBuffer;
      name: string;
      x: number | null;
      y: number | null;
      above: number | null;
    }
  | {
      id: number;
      kind: 'enableCollab';
      session: number;
      layers: string | null;
      seed: boolean;
    }
  | { id: number; kind: 'collabChanges' }
  /** The file and its `layers:<fingerprint>` value, taken together. */
  | { id: number; kind: 'save' }
  | {
      id: number;
      kind: 'registerFont';
      bytes: ArrayBuffer;
      family: string | null;
    };

export type PsdResponse =
  | {
      id: number;
      ok: true;
      kind: 'open';
      summary: Summary;
      warnings: string[];
    }
  | {
      id: number;
      ok: true;
      kind: 'render';
      /** `null` for an empty area. */
      bitmap: ImageBitmap | null;
      millis: number;
    }
  | { id: number; ok: true; kind: 'json'; json: string }
  | { id: number; ok: true; kind: 'bytes'; bytes: ArrayBuffer }
  | {
      id: number;
      ok: true;
      kind: 'saved';
      bytes: ArrayBuffer;
      /** The `layers:<fingerprint>` value of the saved file. */
      layers: string;
    }
  | { id: number; ok: true; kind: 'cancelled' }
  | { id: number; ok: false; error: string; trapped: boolean };
