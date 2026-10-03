/// <reference lib="webworker" />

/**
 * Hosts the PPTX engine (Rust compiled to wasm) off the main thread.
 *
 * Parsing, layout, rasterization, editing, and saving all happen here, so the
 * editor's UI thread only composites bitmaps. Rendered slides are handed back
 * as transferable `ImageBitmap`s. Requests are served one at a time in the
 * order they were posted, which keeps edits, renders, and saves consistent.
 */

import { match } from 'ts-pattern';
import type { PptxRequest, PptxResponse } from './protocol';
import type {
  DeckOutline,
  EditResult,
  SlideOutline,
  TextLayoutInfo,
} from './types';
import {
  discardPptxEngineWasm,
  isWasmTrap,
  loadPptxEngineWasm,
  type WasmPptxDocument,
} from './wasm-module';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** A state change, replayed onto a fresh instance after a trap. */
type LogEntry =
  | { kind: 'apply'; ops: string; group?: string }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'breakGroup' };

interface OpenDocument {
  doc: WasmPptxDocument;
  /** The bytes it was opened from. */
  source: Uint8Array;
  /** Every change since opening, in order. */
  log: LogEntry[];
}

const documents = new Map<string, OpenDocument>();

let queue: Promise<void> = Promise.resolve();

function entryFor(docKey: string): OpenDocument {
  const entry = documents.get(docKey);
  if (!entry) throw new Error(`presentation ${docKey} is not open`);
  return entry;
}

function documentFor(docKey: string): WasmPptxDocument {
  return entryFor(docKey).doc;
}

/** Applies a change and records it for replay. */
function record(
  docKey: string,
  entry: LogEntry,
  run: (doc: WasmPptxDocument) => string | undefined
) {
  const open = entryFor(docKey);
  const result = run(open.doc);
  open.log.push(entry);
  return result;
}

/**
 * A Rust panic traps the wasm instance and can leave its objects unusable.
 * Start a fresh instance and rebuild every open document from its source
 * bytes and change log, so no edit is lost.
 */
async function recover() {
  discardPptxEngineWasm();
  const wasm = await loadPptxEngineWasm();
  for (const [key, open] of [...documents]) {
    try {
      const doc = new wasm.PptxDocument(open.source);
      for (const step of open.log) {
        match(step)
          .with({ kind: 'apply' }, ({ ops, group }) => doc.apply(ops, group))
          .with({ kind: 'undo' }, () => doc.undo())
          .with({ kind: 'redo' }, () => doc.redo())
          .with({ kind: 'breakGroup' }, () => doc.breakGroup())
          .exhaustive();
      }
      open.doc = doc;
    } catch {
      documents.delete(key);
    }
  }
}

async function toBitmap(
  pixels: Uint8Array,
  width: number
): Promise<ImageBitmap> {
  const height = Math.max(1, Math.round(pixels.length / 4 / width));
  const clamped = new Uint8ClampedArray(
    pixels.buffer as ArrayBuffer,
    pixels.byteOffset,
    pixels.byteLength
  );
  return createImageBitmap(new ImageData(clamped, width, height));
}

function editResponse(
  id: number,
  doc: WasmPptxDocument,
  json: string | undefined
): PptxResponse {
  return {
    id,
    ok: true,
    kind: 'edit',
    result: json ? (JSON.parse(json) as EditResult) : null,
    history: { canUndo: doc.canUndo(), canRedo: doc.canRedo() },
  };
}

async function serve(
  request: PptxRequest
): Promise<[PptxResponse, Transferable[]]> {
  const wasm = await loadPptxEngineWasm();
  const { id } = request;
  return match(request)
    .with({ kind: 'open' }, ({ docKey, bytes }) => {
      documents.get(docKey)?.doc.free();
      const source = new Uint8Array(bytes);
      const doc = new wasm.PptxDocument(source);
      documents.set(docKey, { doc, source, log: [] });
      const size = doc.slideSize();
      const response: PptxResponse = {
        id,
        ok: true,
        kind: 'open',
        slideCount: doc.slideCount(),
        size: [size[0], size[1]],
      };
      return [response, []] as [PptxResponse, Transferable[]];
    })
    .with({ kind: 'close' }, ({ docKey }) => {
      documents.get(docKey)?.doc.free();
      documents.delete(docKey);
      return [{ id, ok: true, kind: 'close' }, []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'outline' }, ({ docKey }) => {
      const outline = JSON.parse(documentFor(docKey).outline()) as DeckOutline;
      return [{ id, ok: true, kind: 'outline', outline }, []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'slideOutline' }, ({ docKey, index }) => {
      const slide = JSON.parse(
        documentFor(docKey).slideOutline(index)
      ) as SlideOutline;
      return [{ id, ok: true, kind: 'slideOutline', slide }, []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'render' }, async ({ docKey, index, width }) => {
      const started = performance.now();
      const pixels = documentFor(docKey).render(index, width);
      const bitmap = await toBitmap(pixels, width);
      const millis = performance.now() - started;
      return [{ id, ok: true, kind: 'render', bitmap, millis }, [bitmap]] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with(
      { kind: 'renderLayer' },
      async ({ docKey, index, width, mode, shape }) => {
        const started = performance.now();
        const pixels = documentFor(docKey).renderLayer(
          index,
          width,
          mode,
          shape
        );
        const bitmap = await toBitmap(pixels, width);
        const millis = performance.now() - started;
        return [{ id, ok: true, kind: 'render', bitmap, millis }, [bitmap]] as [
          PptxResponse,
          Transferable[],
        ];
      }
    )
    .with({ kind: 'textLayout' }, ({ docKey, index, shape }) => {
      const layout = JSON.parse(
        documentFor(docKey).textLayout(index, shape)
      ) as TextLayoutInfo | null;
      return [{ id, ok: true, kind: 'textLayout', layout }, []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'apply' }, ({ docKey, ops, group }) => {
      const json = record(docKey, { kind: 'apply', ops, group }, (doc) =>
        doc.apply(ops, group)
      );
      return [editResponse(id, documentFor(docKey), json), []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'breakGroup' }, ({ docKey }) => {
      record(docKey, { kind: 'breakGroup' }, (doc) => {
        doc.breakGroup();
        return undefined;
      });
      return [editResponse(id, documentFor(docKey), undefined), []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'undo' }, ({ docKey }) => {
      const json = record(docKey, { kind: 'undo' }, (doc) => doc.undo());
      return [editResponse(id, documentFor(docKey), json), []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'redo' }, ({ docKey }) => {
      const json = record(docKey, { kind: 'redo' }, (doc) => doc.redo());
      return [editResponse(id, documentFor(docKey), json), []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'save' }, ({ docKey }) => {
      const saved = documentFor(docKey).save();
      const bytes = saved.buffer.slice(
        saved.byteOffset,
        saved.byteOffset + saved.byteLength
      ) as ArrayBuffer;
      return [{ id, ok: true, kind: 'save', bytes }, [bytes]] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .exhaustive();
}

scope.addEventListener('message', (event: MessageEvent<PptxRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      const [response, transfer] = await serve(request);
      scope.postMessage(response, transfer);
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (isWasmTrap(error)) {
        await recover().catch(() => {});
        message =
          'The presentation engine hit a problem with this request and was restarted. Your changes are kept.';
      }
      const response: PptxResponse = {
        id: request.id,
        ok: false,
        error: message,
      };
      scope.postMessage(response);
    }
  });
});
