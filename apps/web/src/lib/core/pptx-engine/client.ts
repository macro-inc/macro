/**
 * The PPTX engine as the app calls it: async functions, worker behind them.
 *
 * One worker per tab, started on first use and kept, so the wasm module is
 * compiled once however many presentations are open. Each open presentation
 * is addressed by a caller-chosen `docKey`.
 */

import type { HistoryState, PptxRequest, PptxResponse } from './protocol';
import type {
  CollabEntries,
  DeckOutline,
  EditOp,
  EditResult,
  EntryChange,
  SlideOutline,
  TextLayoutInfo,
} from './types';

export type { HistoryState } from './protocol';

type Ok = Extract<PptxResponse, { ok: true }>;

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
  const started = new Worker(new URL('./pptx.worker.ts', import.meta.url), {
    type: 'module',
  });
  started.addEventListener('message', (event: MessageEvent<PptxResponse>) => {
    const response = event.data;
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response);
    else waiting.reject(new Error(response.error));
  });
  started.addEventListener('error', (event) => {
    // The worker died: nothing in flight will be answered, and every open
    // presentation died with it.
    const error = new Error(`pptx engine worker failed: ${event.message}`);
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
    worker = undefined;
  });
  worker = started;
  return started;
}

type RequestBody = PptxRequest extends infer R
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
    ensureWorker().postMessage({ ...body, id } as PptxRequest, transfer);
  });
}

/** Opens a presentation (the bytes are transferred to the worker). */
export async function openPresentation(
  docKey: string,
  bytes: ArrayBuffer
): Promise<{ slideCount: number; size: [number, number] }> {
  const r = await request({ kind: 'open', docKey, bytes }, 'open', [bytes]);
  return { slideCount: r.slideCount, size: r.size };
}

/**
 * Opens the presentation that shared collaborative entries describe. `seed`
 * (unique per peer) keeps the names and ids of new parts from colliding.
 */
export async function openPresentationEntries(
  docKey: string,
  entries: CollabEntries,
  seed: number
): Promise<{ slideCount: number; size: [number, number] }> {
  const r = await request(
    { kind: 'openEntries', docKey, entries: JSON.stringify(entries), seed },
    'open'
  );
  return { slideCount: r.slideCount, size: r.size };
}

/**
 * Starts collaborative editing of an opened file; resolves with every entry
 * of the shared maps (the seed of a new shared presentation).
 */
export async function enableCollab(
  docKey: string,
  seed: number
): Promise<EntryChange[]> {
  return (await request({ kind: 'enableCollab', docKey, seed }, 'collab'))
    .changes;
}

/** Applies shared-map changes made elsewhere (other peers, undo, redo). */
export async function applyCollabChanges(
  docKey: string,
  changes: EntryChange[]
): Promise<EditResult | null> {
  const r = await request(
    { kind: 'applyCollab', docKey, changes: JSON.stringify(changes) },
    'edit'
  );
  return r.result;
}

/** Releases a presentation's worker memory. */
export function closePresentation(docKey: string): void {
  void request({ kind: 'close', docKey }, 'close').catch((error: unknown) => {
    console.warn('[pptx-engine] presentation could not be closed', error);
  });
}

/** Slides, shapes, text, and layouts of the whole deck. */
export async function getOutline(docKey: string): Promise<DeckOutline> {
  return (await request({ kind: 'outline', docKey }, 'outline')).outline;
}

/** One slide's outline. */
export async function getSlideOutline(
  docKey: string,
  index: number
): Promise<SlideOutline> {
  return (
    await request({ kind: 'slideOutline', docKey, index }, 'slideOutline')
  ).slide;
}

/** Renders a slide `width` pixels wide. */
export async function renderSlide(
  docKey: string,
  index: number,
  width: number
): Promise<ImageBitmap> {
  const r = await request(
    { kind: 'render', docKey, index, width: Math.round(width) },
    'render'
  );
  return r.bitmap;
}

/**
 * Renders one layer of a slide: everything `without` a shape (the backdrop
 * while it is dragged or typed into) or `only` that shape.
 */
export async function renderSlideLayer(
  docKey: string,
  index: number,
  width: number,
  mode: 'without' | 'only',
  shape: number
): Promise<ImageBitmap> {
  const r = await request(
    {
      kind: 'renderLayer',
      docKey,
      index,
      width: Math.round(width),
      mode,
      shape,
    },
    'render'
  );
  return r.bitmap;
}

/** Caret stops and lines of a shape's text, or `null` when it holds none. */
export async function getTextLayout(
  docKey: string,
  index: number,
  shape: number
): Promise<TextLayoutInfo | null> {
  return (
    await request({ kind: 'textLayout', docKey, index, shape }, 'textLayout')
  ).layout;
}

export interface EditOutcome {
  /** `null` when nothing was undone or redone. */
  result: EditResult | null;
  history: HistoryState;
  /** For a collaborative presentation, the shared-map changes owed. */
  changes?: EntryChange[];
}

/**
 * Applies a batch atomically. Batches sharing a `group` merge into one undo
 * step (a typing burst).
 */
export async function applyEdits(
  docKey: string,
  ops: EditOp[],
  group?: string
): Promise<EditOutcome> {
  const r = await request(
    { kind: 'apply', docKey, ops: JSON.stringify(ops), group },
    'edit'
  );
  return { result: r.result, history: r.history, changes: r.changes };
}

/** Ends the current typing group. */
export async function breakEditGroup(docKey: string): Promise<EditOutcome> {
  const r = await request({ kind: 'breakGroup', docKey }, 'edit');
  return { result: r.result, history: r.history };
}

/** Undoes one step. */
export async function undoEdit(docKey: string): Promise<EditOutcome> {
  const r = await request({ kind: 'undo', docKey }, 'edit');
  return { result: r.result, history: r.history };
}

/** Redoes one step. */
export async function redoEdit(docKey: string): Promise<EditOutcome> {
  const r = await request({ kind: 'redo', docKey }, 'edit');
  return { result: r.result, history: r.history };
}

/** Serializes the current state to `.pptx` bytes. */
export async function savePresentation(docKey: string): Promise<Uint8Array> {
  const r = await request({ kind: 'save', docKey }, 'save');
  return new Uint8Array(r.bytes);
}
