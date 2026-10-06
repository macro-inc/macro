/// <reference lib="webworker" />

/**
 * Hosts the Illustrator engine (Rust compiled to wasm) off the main thread:
 * one worker per open document. Reading the file, rasterization, hit
 * testing, inspection, editing, and saving happen here; rendered tiles go
 * back as transferable `ImageBitmap`s, drawn on the pasteboard color.
 *
 * Requests are queued and served one at a time: queries first, in arrival
 * order, then renders by priority. Renders not yet started can be
 * cancelled.
 */

import { match } from 'ts-pattern';
import type { AiRequest, AiResponse } from './protocol';
import { overColor } from './tile-pixels';
import { isWasmTrap, loadAiEngineWasm, type WasmAiFile } from './wasm-module';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let file: WasmAiFile | undefined;
let trapped = false;

type Render = Extract<AiRequest, { kind: 'render' }>;
const queries: Exclude<AiRequest, Render>[] = [];
const renders: Render[] = [];
let scheduled = false;
let busy = false;

const channel = new MessageChannel();
channel.port1.onmessage = () => {
  scheduled = false;
  void pump();
};

function schedule() {
  if (scheduled || busy) return;
  scheduled = true;
  channel.port2.postMessage(null);
}

function post(response: AiResponse, transfer: Transferable[] = []) {
  scope.postMessage(response, transfer);
}

function fail(id: number, error: unknown) {
  if (isWasmTrap(error)) trapped = true;
  post({
    id,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    trapped,
  });
}

function openFile(): WasmAiFile {
  if (trapped) throw new Error('the engine stopped after an internal error');
  if (!file) throw new Error('no file is open');
  return file;
}

/** A query's JSON answer. */
function query(
  f: WasmAiFile,
  request: Extract<AiRequest, { kind: 'query' }>
): string {
  const [a, b, c, d, e] = request.args;
  return match(request.method)
    .with('summary', () => f.summary())
    .with('rows', () => f.rows())
    .with('info', () => f.info(a as number))
    .with('infos', () => {
      const ids = JSON.parse(a as string) as number[];
      return `[${ids.map((id) => f.info(id)).join(',')}]`;
    })
    .with('hitTest', () =>
      JSON.stringify(
        f.hitTest(a as number, b as number, c as number, d as boolean) ?? null
      )
    )
    .with('inRect', () =>
      f.inRect(a as number, b as number, c as number, d as number, e as boolean)
    )
    .with('bounds', () => f.bounds(a as string))
    .with('fonts', () => f.fonts())
    .with('textGeometry', () => f.textGeometry(a as number))
    .with('describe', () => JSON.stringify(f.describe()))
    .with('isEdited', () => JSON.stringify(f.isEdited()))
    .exhaustive();
}

type Request<K extends AiRequest['kind']> = Extract<AiRequest, { kind: K }>;

async function openDocument(request: Request<'open'>) {
  const wasm = await loadAiEngineWasm();
  file?.free();
  file = new wasm.AiFile(new Uint8Array(request.bytes));
  post({
    id: request.id,
    ok: true,
    kind: 'open',
    summary: JSON.parse(file.summary()),
    warnings: JSON.parse(file.warnings()),
  });
}

async function renderTile(request: Render) {
  const started = performance.now();
  const pixels = openFile().render(
    request.x,
    request.y,
    request.scale,
    request.width,
    request.height,
    true,
    request.outline
  );
  overColor(pixels, request.background);
  const image = new ImageData(
    new Uint8ClampedArray(
      pixels.buffer as ArrayBuffer,
      pixels.byteOffset,
      pixels.length
    ),
    request.width,
    request.height
  );
  const bitmap = await createImageBitmap(image);
  post(
    {
      id: request.id,
      ok: true,
      kind: 'render',
      bitmap,
      millis: performance.now() - started,
    },
    [bitmap]
  );
}

/** Answers with a PNG; an empty one is none. */
function postPng(id: number, png: Uint8Array) {
  const bytes = png.length > 0 ? png.slice().buffer : null;
  post({ id, ok: true, kind: 'png', bytes }, bytes ? [bytes] : []);
}

function postSaved(id: number, saved: Uint8Array) {
  const bytes = saved.slice().buffer;
  post({ id, ok: true, kind: 'saved', bytes }, [bytes]);
}

function edit(request: Request<'edit'>) {
  const f = openFile();
  const json = match(request.action)
    .with('undo', () => f.undo())
    .with('redo', () => f.redo())
    .with('remote', () => f.applyCollab(request.changes ?? '[]'))
    .with('apply', () => f.apply(request.ops ?? '[]', request.coalesce))
    .exhaustive();
  post({ id: request.id, ok: true, kind: 'edit', json });
}

function placeImage(request: Request<'placeImage'>) {
  const json = openFile().placeImage(
    new Uint8Array(request.bytes),
    request.name,
    request.x,
    request.y,
    request.w,
    request.h,
    request.parent
  );
  post({ id: request.id, ok: true, kind: 'edit', json });
}

async function registerFont(request: Request<'registerFont'>) {
  // Fonts belong to the worker (every file it opens), so they can arrive
  // before the file.
  const wasm = await loadAiEngineWasm();
  const json = wasm.AiFile.registerFont(
    new Uint8Array(request.bytes),
    request.family ?? undefined
  );
  post({ id: request.id, ok: true, kind: 'query', json });
}

async function blank(request: Request<'blank'>) {
  const wasm = await loadAiEngineWasm();
  postSaved(request.id, wasm.AiFile.blank(request.width, request.height));
}

const answer = (id: number, json: string) =>
  post({ id, ok: true, kind: 'query', json });

async function serve(request: AiRequest): Promise<void> {
  await match(request)
    .with({ kind: 'open' }, openDocument)
    .with({ kind: 'render' }, renderTile)
    .with({ kind: 'query' }, (r) => answer(r.id, query(openFile(), r)))
    .with({ kind: 'thumbnail' }, (r) =>
      postPng(r.id, openFile().thumbnail(r.node, r.size))
    )
    .with({ kind: 'exportPng' }, (r) =>
      postPng(
        r.id,
        openFile().exportPng(r.artboard ?? undefined, r.scale, r.transparent)
      )
    )
    .with({ kind: 'edit' }, edit)
    .with({ kind: 'placeImage' }, placeImage)
    .with({ kind: 'enableCollab' }, (r) =>
      answer(r.id, openFile().enableCollab(r.session, r.seed))
    )
    .with({ kind: 'collabChanges' }, (r) =>
      answer(r.id, openFile().collabChanges())
    )
    .with({ kind: 'registerFont' }, registerFont)
    .with({ kind: 'blank' }, blank)
    .with({ kind: 'save' }, (r) => postSaved(r.id, openFile().save()))
    .with({ kind: 'cancel' }, () => undefined)
    .exhaustive();
}

function takeRender(): Render | undefined {
  if (renders.length === 0) return undefined;
  let best = 0;
  for (let i = 1; i < renders.length; i++) {
    if (renders[i].priority < renders[best].priority) best = i;
  }
  return renders.splice(best, 1)[0];
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    const request = queries.shift() ?? takeRender();
    if (!request) return;
    try {
      await serve(request);
    } catch (error) {
      fail(request.id, error);
    }
  } finally {
    busy = false;
    if (queries.length > 0 || renders.length > 0) schedule();
  }
}

scope.addEventListener('message', (event: MessageEvent<AiRequest>) => {
  const request = event.data;
  if (request.kind === 'cancel') {
    const drop = new Set(request.ids);
    for (let i = renders.length - 1; i >= 0; i--) {
      if (drop.has(renders[i].id)) {
        post({ id: renders[i].id, ok: true, kind: 'cancelled' });
        renders.splice(i, 1);
      }
    }
    return;
  }
  if (request.kind === 'render') renders.push(request);
  else queries.push(request);
  schedule();
});
