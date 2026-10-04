/**
 * The DOCX engine as the app calls it: async functions, worker behind them.
 *
 * One worker per tab, started on first use and kept, so the wasm module is
 * compiled once however many documents are open. Each open document is
 * addressed by a caller-chosen `docKey`.
 */

import type { DocxRequest, DocxResponse } from './protocol';
import type {
  CaretRect,
  CollabState,
  EditOp,
  EditResult,
  PageInfo,
  PageRect,
  ParagraphText,
  Pos,
  RemoteChange,
  StyleInfo,
  V1State,
} from './types';

type Ok = Extract<DocxResponse, { ok: true }>;

interface Pending {
  resolve: (response: Ok) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
const pending = new Map<number, Pending>();
let nextId = 0;

/**
 * Lazily constructed on purpose: on iOS, WKWebView deadlocks when a module
 * Worker is constructed eagerly over `tauri://` (apps/web/AGENTS.md).
 */
function ensureWorker(): Worker {
  if (worker) return worker;
  const started = new Worker(new URL('./docx.worker.ts', import.meta.url), {
    type: 'module',
  });
  started.addEventListener('message', (event: MessageEvent<DocxResponse>) => {
    const response = event.data;
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response);
    else waiting.reject(new Error(response.error));
  });
  started.addEventListener('error', (event) => {
    // The worker died: nothing in flight will be answered, and every open
    // document died with it.
    const error = new Error(`docx engine worker failed: ${event.message}`);
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
    worker = undefined;
  });
  worker = started;
  return started;
}

type RequestBody = DocxRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

function request<K extends Ok['kind']>(
  body: RequestBody,
  expect: K,
  transfer: Transferable[] = []
): Promise<Extract<Ok, { kind: K }>> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (response) => {
        if (response.kind === expect) {
          resolve(response as Extract<Ok, { kind: K }>);
        } else {
          reject(
            new Error(`unexpected ${response.kind} response to ${body.kind}`)
          );
        }
      },
      reject,
    });
    ensureWorker().postMessage({ ...body, id } as DocxRequest, transfer);
  });
}

export type Opened = { pages: PageInfo[]; state: EditResult };

/** Opens a `.docx` (the bytes are transferred to the worker). */
export async function openDocument(
  docKey: string,
  bytes: ArrayBuffer
): Promise<Opened> {
  const r = await request({ kind: 'open', docKey, bytes }, 'open', [bytes]);
  return { pages: r.pages, state: r.state };
}

/**
 * Opens the document shared state describes. `seed` (unique per peer)
 * keeps the ids of new blocks and parts from colliding.
 */
export async function openCollabDocument(
  docKey: string,
  state: CollabState,
  seed: number
): Promise<Opened> {
  const r = await request(
    { kind: 'openCollab', docKey, state: JSON.stringify(state), seed },
    'open'
  );
  return { pages: r.pages, state: r.state };
}

/** Opens a document stored in the first shared format. */
export async function openV1Document(
  docKey: string,
  state: V1State
): Promise<Opened> {
  const r = await request(
    { kind: 'openV1', docKey, state: JSON.stringify(state) },
    'open'
  );
  return { pages: r.pages, state: r.state };
}

/** The document's shared state. */
export async function collabState(docKey: string): Promise<CollabState> {
  const r = await request({ kind: 'collabState', docKey }, 'collabState');
  return JSON.parse(r.state) as CollabState;
}

export async function closeDocument(docKey: string): Promise<void> {
  await request({ kind: 'close', docKey }, 'close');
}

/** Applies operations (one undo step, merged with the last of the same `group`). */
export async function applyOps(
  docKey: string,
  ops: EditOp[],
  group?: string
): Promise<EditResult | null> {
  const r = await request(
    { kind: 'apply', docKey, ops: JSON.stringify(ops), group },
    'edit'
  );
  return r.result;
}

/** Applies other peers' changes. */
export async function applyRemote(
  docKey: string,
  changes: RemoteChange[]
): Promise<EditResult | null> {
  const r = await request(
    { kind: 'applyRemote', docKey, changes: JSON.stringify(changes) },
    'edit'
  );
  return r.result;
}

export async function currentState(docKey: string): Promise<EditResult | null> {
  const r = await request({ kind: 'state', docKey }, 'edit');
  return r.result;
}

/** Shows tracked changes inline (`true`) or the final text. */
export async function setMarkup(
  docKey: string,
  markup: boolean
): Promise<EditResult | null> {
  const r = await request({ kind: 'setMarkup', docKey, markup }, 'edit');
  return r.result;
}

/** Leaves undo history to the shared document's undo manager. */
export async function setExternalUndo(
  docKey: string,
  external: boolean
): Promise<void> {
  await request({ kind: 'setExternalUndo', docKey, external }, 'done');
}

/** The name tracked changes are recorded under. */
export async function setAuthor(docKey: string, author: string) {
  await request({ kind: 'setAuthor', docKey, author }, 'done');
}

export async function breakGroup(docKey: string): Promise<void> {
  await request({ kind: 'breakGroup', docKey }, 'done');
}

export async function undo(docKey: string): Promise<EditResult | null> {
  const r = await request({ kind: 'undo', docKey }, 'edit');
  return r.result;
}

export async function redo(docKey: string): Promise<EditResult | null> {
  const r = await request({ kind: 'redo', docKey }, 'edit');
  return r.result;
}

export type Rendered = { bitmap: ImageBitmap; millis: number };

/** Renders a page `width` pixels wide. */
export async function renderPage(
  docKey: string,
  page: number,
  width: number
): Promise<Rendered> {
  const r = await request({ kind: 'render', docKey, page, width }, 'render');
  return { bitmap: r.bitmap, millis: r.millis };
}

/** Renders a strip (`top..bottom` points) of a page `width` pixels wide. */
export async function renderBand(
  docKey: string,
  page: number,
  width: number,
  top: number,
  bottom: number
): Promise<Rendered> {
  const r = await request(
    { kind: 'renderBand', docKey, page, width, top, bottom },
    'render'
  );
  return { bitmap: r.bitmap, millis: r.millis };
}

/** The position at a point on a page (points). */
export async function hitTest(
  docKey: string,
  page: number,
  x: number,
  y: number
): Promise<Pos | null> {
  const r = await request({ kind: 'hitTest', docKey, page, x, y }, 'pos');
  return r.pos;
}

export async function caretAt(
  docKey: string,
  pos: Pos
): Promise<CaretRect | null> {
  const r = await request({ kind: 'caretAt', docKey, pos }, 'caret');
  return r.caret;
}

export async function rangeRects(
  docKey: string,
  from: Pos,
  to: Pos
): Promise<PageRect[]> {
  const r = await request({ kind: 'rangeRects', docKey, from, to }, 'rects');
  return r.rects;
}

/** The selected text, for the clipboard. */
export async function selectedText(docKey: string): Promise<string> {
  const r = await request({ kind: 'selectedText', docKey }, 'text');
  return r.text;
}

export async function paragraphs(docKey: string): Promise<ParagraphText[]> {
  const r = await request({ kind: 'paragraphs', docKey }, 'paragraphs');
  return r.paragraphs;
}

export async function styles(docKey: string): Promise<StyleInfo[]> {
  const r = await request({ kind: 'styles', docKey }, 'styles');
  return r.styles;
}

/** Serializes the document to `.docx` bytes. */
export async function saveDocument(docKey: string): Promise<Uint8Array> {
  const r = await request({ kind: 'save', docKey }, 'save');
  return new Uint8Array(r.bytes);
}
