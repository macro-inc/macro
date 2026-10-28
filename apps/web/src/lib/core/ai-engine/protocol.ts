/**
 * Messages exchanged with an Illustrator engine worker.
 *
 * Requests are correlated by `id`. A worker hosts one document. Queries
 * (layers, hit tests, properties) are served before queued tile renders so
 * the UI stays responsive while tiles rasterize, and queued renders can be
 * cancelled when the view moves on.
 */

import type { Summary } from './types';

/** Engine methods answered with JSON. */
export type QueryMethod =
  | 'summary'
  | 'rows'
  | 'info'
  | 'infos'
  | 'hitTest'
  | 'inRect'
  | 'bounds'
  | 'fonts'
  | 'textGeometry'
  | 'describe'
  | 'isEdited';

export type AiRequest =
  | { id: number; kind: 'open'; bytes: ArrayBuffer }
  | {
      id: number;
      kind: 'render';
      /** Canvas coordinates of the tile's top-left corner. */
      x: number;
      y: number;
      /** Device pixels per canvas unit. */
      scale: number;
      width: number;
      height: number;
      outline: boolean;
      /** The pasteboard color the tile is drawn on (0–255 RGB). */
      background: [number, number, number];
      /** Lower renders first. */
      priority: number;
    }
  | { id: number; kind: 'cancel'; ids: number[] }
  | {
      id: number;
      kind: 'query';
      method: QueryMethod;
      args: (string | number | boolean | null)[];
    }
  | { id: number; kind: 'thumbnail'; node: number; size: number }
  | {
      id: number;
      kind: 'exportPng';
      artboard: number | null;
      scale: number;
      transparent: boolean;
    }
  | {
      id: number;
      kind: 'edit';
      /** `remote`: other people's changes (outside the undo history). */
      action: 'apply' | 'undo' | 'redo' | 'remote';
      /** `Op[]` JSON, for `apply`. */
      ops?: string;
      /** Steps with the same key in a row undo as one (a drag). */
      coalesce?: string;
      /** `EntryChange[]` JSON, for `remote`. */
      changes?: string;
    }
  | {
      id: number;
      kind: 'placeImage';
      bytes: ArrayBuffer;
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      parent: number | null;
    }
  | { id: number; kind: 'enableCollab'; session: number; seed: boolean }
  | { id: number; kind: 'collabChanges' }
  | { id: number; kind: 'save' }
  | { id: number; kind: 'blank'; width: number; height: number }
  | {
      id: number;
      kind: 'registerFont';
      bytes: ArrayBuffer;
      /** The family to register it as (else the one it names). */
      family: string | null;
    };

export type AiResponse =
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
      bitmap: ImageBitmap;
      millis: number;
    }
  | { id: number; ok: true; kind: 'query'; json: string }
  | { id: number; ok: true; kind: 'png'; bytes: ArrayBuffer | null }
  | { id: number; ok: true; kind: 'edit'; json: string }
  | { id: number; ok: true; kind: 'saved'; bytes: ArrayBuffer }
  | { id: number; ok: true; kind: 'cancelled' }
  | { id: number; ok: false; error: string; trapped: boolean };
