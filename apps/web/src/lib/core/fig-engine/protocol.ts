/**
 * Messages exchanged with a `.fig` engine worker.
 *
 * Requests are correlated by `id`. A worker hosts one file. Queries (layers,
 * hit tests, properties) are served before queued tile renders so the UI
 * stays responsive while tiles rasterize, and queued renders can be
 * cancelled when the view moves on.
 */

import type { FileSummary, PageLayout } from './types';

/** Engine methods answered with JSON. */
export type QueryMethod =
  | 'layers'
  | 'rows'
  | 'nodeInfo'
  | 'hitTest'
  | 'ancestry'
  | 'geometry'
  | 'outline'
  | 'search'
  | 'inRect';

export type FigRequest =
  | { id: number; kind: 'open'; bytes: ArrayBuffer }
  | { id: number; kind: 'openPage'; page: number }
  | {
      id: number;
      kind: 'render';
      page: number;
      x: number;
      y: number;
      scale: number;
      width: number;
      height: number;
      outline: boolean;
      /** Lower renders first. */
      priority: number;
    }
  | { id: number; kind: 'cancel'; ids: number[] }
  | {
      id: number;
      kind: 'query';
      method: QueryMethod;
      args: (string | number | null)[];
    }
  | { id: number; kind: 'export'; page: number; node: string; scale: number }
  | { id: number; kind: 'thumbnail' };

export type FigResponse =
  | { id: number; ok: true; kind: 'open'; summary: FileSummary }
  | { id: number; ok: true; kind: 'openPage'; layout: PageLayout }
  | {
      id: number;
      ok: true;
      kind: 'render';
      bitmap: ImageBitmap;
      millis: number;
    }
  | { id: number; ok: true; kind: 'query'; json: string }
  | { id: number; ok: true; kind: 'png'; bytes: ArrayBuffer | null }
  | { id: number; ok: true; kind: 'cancelled' }
  | { id: number; ok: false; error: string; trapped: boolean };
