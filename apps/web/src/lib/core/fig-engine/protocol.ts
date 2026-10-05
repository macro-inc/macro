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
  | 'summary'
  | 'layers'
  | 'rows'
  | 'nodeInfo'
  | 'hitTest'
  | 'ancestry'
  | 'geometry'
  | 'outline'
  | 'search'
  | 'pageColors'
  | 'components'
  | 'styles'
  | 'designInfo'
  | 'inRect'
  | 'exportSvg'
  | 'vectorNetwork';

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
  | { id: number; kind: 'thumbnail' }
  | {
      id: number;
      kind: 'edit';
      page: number;
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
      kind: 'enableCollab';
      session: number;
      baseBlobs: number | null;
    }
  | { id: number; kind: 'collabChanges' }
  | { id: number; kind: 'save' }
  | { id: number; kind: 'blank'; name: string }
  | { id: number; kind: 'addImage'; hash: string; bytes: ArrayBuffer }
  /** Copies layers (`string[]` JSON) as a clipboard payload. */
  | { id: number; kind: 'copy'; page: number; ids: string }
  | {
      id: number;
      kind: 'paste';
      page: number;
      /** A `.fig` document of copied layers. */
      document: ArrayBuffer;
      /** A ZIP of the images they use. */
      images: ArrayBuffer | null;
      /** `PasteSpec` JSON. */
      spec: string;
    };

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
  | { id: number; ok: true; kind: 'edit'; json: string }
  | { id: number; ok: true; kind: 'saved'; bytes: ArrayBuffer }
  | {
      id: number;
      ok: true;
      kind: 'copied';
      document: ArrayBuffer;
      images: ArrayBuffer;
    }
  | { id: number; ok: true; kind: 'cancelled' }
  | { id: number; ok: false; error: string; trapped: boolean };
