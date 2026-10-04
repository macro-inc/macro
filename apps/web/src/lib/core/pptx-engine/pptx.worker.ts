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
  EntryChange,
  LinkRegion,
  PresetPath,
  SlideOutline,
  TextLayoutInfo,
  TextMatch,
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
  | { kind: 'breakGroup' }
  | { kind: 'enableCollab'; seed: number }
  | { kind: 'collabChanges' }
  | { kind: 'applyCollab'; changes: string };

/** What a document was opened from. */
type Source =
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'entries'; entries: string; seed: number };

interface OpenDocument {
  doc: WasmPptxDocument;
  source: Source;
  /** Whether it takes part in collaborative editing. */
  collab: boolean;
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
      const doc =
        open.source.kind === 'bytes'
          ? new wasm.PptxDocument(open.source.bytes)
          : wasm.PptxDocument.fromEntries(
              open.source.entries,
              open.source.seed
            );
      // Replaying the same calls in order also replays the same random ids.
      for (const step of open.log) {
        match(step)
          .with({ kind: 'apply' }, ({ ops, group }) => doc.apply(ops, group))
          .with({ kind: 'undo' }, () => doc.undo())
          .with({ kind: 'redo' }, () => doc.redo())
          .with({ kind: 'breakGroup' }, () => doc.breakGroup())
          .with({ kind: 'enableCollab' }, ({ seed }) => doc.enableCollab(seed))
          .with({ kind: 'collabChanges' }, () => doc.collabChanges())
          .with({ kind: 'applyCollab' }, ({ changes }) =>
            doc.applyCollab(changes)
          )
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
  json: string | undefined,
  changes?: EntryChange[]
): PptxResponse {
  return {
    id,
    ok: true,
    kind: 'edit',
    result: json ? (JSON.parse(json) as EditResult) : null,
    history: { canUndo: doc.canUndo(), canRedo: doc.canRedo() },
    changes,
  };
}

/** The shared-map changes a collaborative document owes after a change. */
function takeChanges(docKey: string): EntryChange[] {
  const json = record(docKey, { kind: 'collabChanges' }, (doc) =>
    doc.collabChanges()
  );
  return JSON.parse(json ?? '[]') as EntryChange[];
}

function openResponse(id: number, doc: WasmPptxDocument): PptxResponse {
  const size = doc.slideSize();
  return {
    id,
    ok: true,
    kind: 'open',
    slideCount: doc.slideCount(),
    size: [size[0], size[1]],
  };
}

async function serve(
  request: PptxRequest
): Promise<[PptxResponse, Transferable[]]> {
  const wasm = await loadPptxEngineWasm();
  const { id } = request;
  return match(request)
    .with({ kind: 'open' }, ({ docKey, bytes }) => {
      const source = new Uint8Array(bytes);
      // Parse first: a file that fails to open leaves the current one in place.
      const doc = new wasm.PptxDocument(source);
      documents.get(docKey)?.doc.free();
      documents.set(docKey, {
        doc,
        source: { kind: 'bytes', bytes: source },
        collab: false,
        log: [],
      });
      return [openResponse(id, doc), []] as [PptxResponse, Transferable[]];
    })
    .with({ kind: 'openEntries' }, ({ docKey, entries, seed }) => {
      const doc = wasm.PptxDocument.fromEntries(entries, seed);
      documents.get(docKey)?.doc.free();
      documents.set(docKey, {
        doc,
        source: { kind: 'entries', entries, seed },
        collab: true,
        log: [],
      });
      return [openResponse(id, doc), []] as [PptxResponse, Transferable[]];
    })
    .with({ kind: 'enableCollab' }, ({ docKey, seed }) => {
      record(docKey, { kind: 'enableCollab', seed }, (doc) => {
        doc.enableCollab(seed);
        return undefined;
      });
      entryFor(docKey).collab = true;
      const changes = takeChanges(docKey);
      return [{ id, ok: true, kind: 'collab', changes }, []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'applyCollab' }, ({ docKey, changes }) => {
      const json = record(docKey, { kind: 'applyCollab', changes }, (doc) =>
        doc.applyCollab(changes)
      );
      return [editResponse(id, documentFor(docKey), json), []] as [
        PptxResponse,
        Transferable[],
      ];
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
    .with(
      { kind: 'renderSpan' },
      async ({ docKey, index, width, start, end, backdrop }) => {
        const started = performance.now();
        const pixels = documentFor(docKey).renderSpan(
          index,
          width,
          start,
          end,
          backdrop
        );
        const bitmap = await toBitmap(pixels, width);
        const millis = performance.now() - started;
        return [{ id, ok: true, kind: 'render', bitmap, millis }, [bitmap]] as [
          PptxResponse,
          Transferable[],
        ];
      }
    )
    .with({ kind: 'presetPaths' }, ({ names, width, height }) => {
      const paths: Record<string, PresetPath[]> = {};
      for (const name of names) {
        const json = JSON.parse(wasm.presetPaths(name, width, height)) as
          | PresetPath[]
          | null;
        if (json) paths[name] = json;
      }
      return [{ id, ok: true, kind: 'presetPaths', paths }, []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'textLayout' }, ({ docKey, index, shape, cell }) => {
      const layout = JSON.parse(
        documentFor(docKey).textLayout(index, shape, cell?.row, cell?.col)
      ) as TextLayoutInfo | null;
      return [{ id, ok: true, kind: 'textLayout', layout }, []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'linkRegions' }, ({ docKey, index }) => {
      const regions = JSON.parse(
        documentFor(docKey).linkRegions(index)
      ) as LinkRegion[];
      return [{ id, ok: true, kind: 'linkRegions', regions }, []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'apply' }, ({ docKey, ops, group }) => {
      const json = record(docKey, { kind: 'apply', ops, group }, (doc) =>
        doc.apply(ops, group)
      );
      const changes = entryFor(docKey).collab ? takeChanges(docKey) : undefined;
      return [editResponse(id, documentFor(docKey), json, changes), []] as [
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
    .with({ kind: 'copyShapes' }, ({ docKey, index, shapes }) => {
      const payload = documentFor(docKey).copyShapes(
        index,
        JSON.stringify(shapes)
      );
      return [{ id, ok: true, kind: 'clipboard', payload }, []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'copySlides' }, ({ docKey, slides }) => {
      const payload = documentFor(docKey).copySlides(JSON.stringify(slides));
      return [{ id, ok: true, kind: 'clipboard', payload }, []] as [
        PptxResponse,
        Transferable[],
      ];
    })
    .with({ kind: 'findText' }, ({ docKey, query, options }) => {
      const matches = JSON.parse(
        documentFor(docKey).findText(query, JSON.stringify(options ?? {}))
      ) as TextMatch[];
      return [{ id, ok: true, kind: 'matches', matches }, []] as [
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
