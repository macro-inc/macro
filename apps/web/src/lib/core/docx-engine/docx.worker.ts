/// <reference lib="webworker" />

/**
 * Hosts the DOCX engine (Rust compiled to wasm) off the main thread.
 *
 * Parsing, layout, rasterization, editing and saving all happen here, so
 * the editor's UI thread only composites bitmaps and positions overlays.
 * Rendered pages and strips come back as transferable `ImageBitmap`s.
 * Requests are served one at a time in the order they were posted, which
 * keeps edits, renders and saves consistent.
 */

import { match } from 'ts-pattern';
import type { DocxRequest, DocxResponse } from './protocol';
import type {
  CaretRect,
  Clip,
  EditResult,
  FindResult,
  PageInfo,
  PageRect,
  ParagraphText,
  Pos,
  StyleInfo,
} from './types';
import {
  discardDocxEngineWasm,
  isWasmTrap,
  loadDocxEngineWasm,
  type WasmDocxDocument,
} from './wasm-module';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** A state change, replayed onto a fresh instance after a trap. */
type LogEntry =
  | { kind: 'apply'; ops: string; group?: string }
  | { kind: 'applyRemote'; changes: string }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'breakGroup' }
  | { kind: 'setMarkup'; markup: boolean }
  | { kind: 'setExternalUndo'; external: boolean }
  | { kind: 'setAuthor'; author: string };

/** What a document was opened from. */
type Source =
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'collab'; state: string; seed: number }
  | { kind: 'v1'; state: string };

interface OpenDocument {
  doc: WasmDocxDocument;
  source: Source;
  /** Every change since opening, in order. */
  log: LogEntry[];
}

const documents = new Map<string, OpenDocument>();

let queue: Promise<void> = Promise.resolve();

function entryFor(docKey: string): OpenDocument {
  const entry = documents.get(docKey);
  if (!entry) throw new Error(`document ${docKey} is not open`);
  return entry;
}

function documentFor(docKey: string): WasmDocxDocument {
  return entryFor(docKey).doc;
}

/** Applies a change and records it for replay. */
function record<T>(
  docKey: string,
  entry: LogEntry,
  run: (doc: WasmDocxDocument) => T
): T {
  const open = entryFor(docKey);
  const result = run(open.doc);
  open.log.push(entry);
  return result;
}

type WasmModule = Awaited<ReturnType<typeof loadDocxEngineWasm>>;

function openSource(wasm: WasmModule, source: Source): WasmDocxDocument {
  return match(source)
    .with({ kind: 'bytes' }, ({ bytes }) => new wasm.DocxDocument(bytes))
    .with({ kind: 'collab' }, ({ state, seed }) =>
      wasm.DocxDocument.fromCollab(state, seed)
    )
    .with({ kind: 'v1' }, ({ state }) => wasm.DocxDocument.fromV1(state))
    .exhaustive();
}

/**
 * A Rust panic traps the wasm instance and can leave its objects unusable.
 * Start a fresh instance and rebuild every open document from its source
 * and change log, so no edit is lost.
 */
async function recover() {
  discardDocxEngineWasm();
  const wasm = await loadDocxEngineWasm();
  for (const [key, open] of [...documents]) {
    try {
      const doc = openSource(wasm, open.source);
      // Replaying the same calls in order also replays the same random ids.
      for (const step of open.log) {
        match(step)
          .with({ kind: 'apply' }, ({ ops, group }) => doc.apply(ops, group))
          .with({ kind: 'applyRemote' }, ({ changes }) =>
            doc.applyRemote(changes)
          )
          .with({ kind: 'undo' }, () => doc.undo())
          .with({ kind: 'redo' }, () => doc.redo())
          .with({ kind: 'breakGroup' }, () => doc.breakGroup())
          .with({ kind: 'setMarkup' }, ({ markup }) => doc.setMarkup(markup))
          .with({ kind: 'setExternalUndo' }, ({ external }) =>
            doc.setExternalUndo(external)
          )
          .with({ kind: 'setAuthor' }, ({ author }) => doc.setAuthor(author))
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

type Served = [DocxResponse, Transferable[]];

function edit(id: number, json: string | undefined): Served {
  return [
    {
      id,
      ok: true,
      kind: 'edit',
      result: json ? (JSON.parse(json) as EditResult) : null,
    },
    [],
  ];
}

function opened(id: number, doc: WasmDocxDocument): Served {
  return [
    {
      id,
      ok: true,
      kind: 'open',
      pages: JSON.parse(doc.pages()) as PageInfo[],
      state: JSON.parse(doc.state()) as EditResult,
    },
    [],
  ];
}

function install(docKey: string, doc: WasmDocxDocument, source: Source) {
  documents.get(docKey)?.doc.free();
  documents.set(docKey, { doc, source, log: [] });
}

async function serve(request: DocxRequest): Promise<Served> {
  const wasm = await loadDocxEngineWasm();
  const { id } = request;
  return match(request)
    .with({ kind: 'open' }, ({ docKey, bytes }): Served => {
      const source: Source = { kind: 'bytes', bytes: new Uint8Array(bytes) };
      // Parse first: a file that fails to open leaves the current one in place.
      const doc = openSource(wasm, source);
      install(docKey, doc, source);
      return opened(id, doc);
    })
    .with({ kind: 'openCollab' }, ({ docKey, state, seed }): Served => {
      const source: Source = { kind: 'collab', state, seed };
      const doc = openSource(wasm, source);
      install(docKey, doc, source);
      return opened(id, doc);
    })
    .with({ kind: 'openV1' }, ({ docKey, state }): Served => {
      const source: Source = { kind: 'v1', state };
      const doc = openSource(wasm, source);
      install(docKey, doc, source);
      return opened(id, doc);
    })
    .with(
      { kind: 'collabState' },
      ({ docKey }): Served => [
        {
          id,
          ok: true,
          kind: 'collabState',
          state: documentFor(docKey).collabState(),
        },
        [],
      ]
    )
    .with({ kind: 'close' }, ({ docKey }): Served => {
      documents.get(docKey)?.doc.free();
      documents.delete(docKey);
      return [{ id, ok: true, kind: 'close' }, []];
    })
    .with({ kind: 'apply' }, ({ docKey, ops, group }) =>
      edit(
        id,
        record(docKey, { kind: 'apply', ops, group }, (doc) =>
          doc.apply(ops, group)
        )
      )
    )
    .with({ kind: 'applyRemote' }, ({ docKey, changes }) =>
      edit(
        id,
        record(docKey, { kind: 'applyRemote', changes }, (doc) =>
          doc.applyRemote(changes)
        )
      )
    )
    .with({ kind: 'state' }, ({ docKey }) =>
      edit(id, documentFor(docKey).state())
    )
    .with({ kind: 'setMarkup' }, ({ docKey, markup }) =>
      edit(
        id,
        record(docKey, { kind: 'setMarkup', markup }, (doc) =>
          doc.setMarkup(markup)
        )
      )
    )
    .with({ kind: 'setAuthor' }, ({ docKey, author }): Served => {
      record(docKey, { kind: 'setAuthor', author }, (doc) =>
        doc.setAuthor(author)
      );
      return [{ id, ok: true, kind: 'done' }, []];
    })
    .with({ kind: 'setExternalUndo' }, ({ docKey, external }): Served => {
      record(docKey, { kind: 'setExternalUndo', external }, (doc) =>
        doc.setExternalUndo(external)
      );
      return [{ id, ok: true, kind: 'done' }, []];
    })
    .with({ kind: 'breakGroup' }, ({ docKey }): Served => {
      record(docKey, { kind: 'breakGroup' }, (doc) => doc.breakGroup());
      return [{ id, ok: true, kind: 'done' }, []];
    })
    .with({ kind: 'undo' }, ({ docKey }) =>
      edit(
        id,
        record(docKey, { kind: 'undo' }, (doc) => doc.undo())
      )
    )
    .with({ kind: 'redo' }, ({ docKey }) =>
      edit(
        id,
        record(docKey, { kind: 'redo' }, (doc) => doc.redo())
      )
    )
    .with(
      { kind: 'render' },
      async ({ docKey, page, width }): Promise<Served> => {
        const started = performance.now();
        const pixels = documentFor(docKey).render(page, width);
        const bitmap = await toBitmap(pixels, width);
        const millis = performance.now() - started;
        return [{ id, ok: true, kind: 'render', bitmap, millis }, [bitmap]];
      }
    )
    .with(
      { kind: 'renderBand' },
      async ({ docKey, page, width, top, bottom }): Promise<Served> => {
        const started = performance.now();
        const pixels = documentFor(docKey).renderBand(page, width, top, bottom);
        const bitmap = await toBitmap(pixels, width);
        const millis = performance.now() - started;
        return [{ id, ok: true, kind: 'render', bitmap, millis }, [bitmap]];
      }
    )
    .with(
      { kind: 'hitTest' },
      ({ docKey, page, x, y }): Served => [
        {
          id,
          ok: true,
          kind: 'pos',
          pos: JSON.parse(
            documentFor(docKey).hitTest(page, x, y)
          ) as Pos | null,
        },
        [],
      ]
    )
    .with(
      { kind: 'caretAt' },
      ({ docKey, pos }): Served => [
        {
          id,
          ok: true,
          kind: 'caret',
          caret: JSON.parse(
            documentFor(docKey).caretAt(JSON.stringify(pos))
          ) as CaretRect | null,
        },
        [],
      ]
    )
    .with(
      { kind: 'rangeRects' },
      ({ docKey, from, to }): Served => [
        {
          id,
          ok: true,
          kind: 'rects',
          rects: JSON.parse(
            documentFor(docKey).rangeRects(
              JSON.stringify(from),
              JSON.stringify(to)
            )
          ) as PageRect[],
        },
        [],
      ]
    )
    .with(
      { kind: 'copySelection' },
      ({ docKey }): Served => [
        {
          id,
          ok: true,
          kind: 'clip',
          clip: JSON.parse(documentFor(docKey).copySelection()) as Clip,
        },
        [],
      ]
    )
    .with(
      { kind: 'find' },
      ({ docKey, query, options }): Served => [
        {
          id,
          ok: true,
          kind: 'find',
          result: JSON.parse(
            documentFor(docKey).find(query, JSON.stringify(options))
          ) as FindResult,
        },
        [],
      ]
    )
    .with(
      { kind: 'selectedText' },
      ({ docKey }): Served => [
        {
          id,
          ok: true,
          kind: 'text',
          text: documentFor(docKey).selectedText(),
        },
        [],
      ]
    )
    .with(
      { kind: 'paragraphs' },
      ({ docKey }): Served => [
        {
          id,
          ok: true,
          kind: 'paragraphs',
          paragraphs: JSON.parse(
            documentFor(docKey).paragraphs()
          ) as ParagraphText[],
        },
        [],
      ]
    )
    .with(
      { kind: 'styles' },
      ({ docKey }): Served => [
        {
          id,
          ok: true,
          kind: 'styles',
          styles: JSON.parse(documentFor(docKey).styles()) as StyleInfo[],
        },
        [],
      ]
    )
    .with({ kind: 'save' }, ({ docKey }): Served => {
      const saved = documentFor(docKey).save();
      const bytes = saved.buffer.slice(
        saved.byteOffset,
        saved.byteOffset + saved.byteLength
      ) as ArrayBuffer;
      return [{ id, ok: true, kind: 'save', bytes }, [bytes]];
    })
    .exhaustive();
}

scope.addEventListener('message', (event: MessageEvent<DocxRequest>) => {
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
          'The document engine hit a problem with this request and was restarted. Your changes are kept.';
      }
      const response: DocxResponse = {
        id: request.id,
        ok: false,
        error: message,
      };
      scope.postMessage(response);
    }
  });
});
