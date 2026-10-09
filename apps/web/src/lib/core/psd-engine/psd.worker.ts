/// <reference lib="webworker" />

/**
 * Hosts the Photoshop engine (Rust compiled to wasm) off the main thread:
 * one worker per open document. Reading, compositing, editing, selections,
 * and saving all happen here; composited tiles go back as transferable
 * `ImageBitmap`s.
 *
 * Requests are served one at a time: everything but renders first, in
 * arrival order (so a render always shows the edits sent before it), then
 * renders by priority. Renders not yet started can be cancelled.
 */

import { isWasmTrap } from '@core/fig-engine/wasm-module';
import { match } from 'ts-pattern';
import type { PsdRequest, PsdResponse } from './protocol';
import { loadPsdEngineWasm, type WasmPsdFile } from './wasm-module';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let file: WasmPsdFile | undefined;
let trapped = false;

type Render = Extract<PsdRequest, { kind: 'render' }>;
const queries: Exclude<PsdRequest, Render>[] = [];
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

function post(response: PsdResponse, transfer: Transferable[] = []) {
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

function openFile(): WasmPsdFile {
  if (trapped) throw new Error('the engine stopped after an internal error');
  if (!file) throw new Error('no document is open');
  return file;
}

const optional = (v: number | null | undefined) => v ?? undefined;

function postBytes(id: number, bytes: Uint8Array) {
  const buffer = bytes.slice().buffer;
  post({ id, ok: true, kind: 'bytes', bytes: buffer }, [buffer]);
}

async function render(request: Render) {
  const started = performance.now();
  if (request.width <= 0 || request.height <= 0) {
    post({ id: request.id, ok: true, kind: 'render', bitmap: null, millis: 0 });
    return;
  }
  const pixels = openFile().render(
    request.x,
    request.y,
    request.level,
    request.width,
    request.height
  );
  // Straight alpha, as ImageData expects.
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

function query(request: Extract<PsdRequest, { kind: 'query' }>): string {
  const f = openFile();
  const [a, b] = request.args;
  return match(request.method)
    .with('summary', () => f.summary())
    .with('warnings', () => f.warnings())
    .with('layers', () => f.layers())
    .with('layerInfo', () => f.layerInfo(a ?? 0))
    .with('hitTest', () => JSON.stringify(f.hitTest(a ?? 0, b ?? 0) ?? null))
    .with('selectionInfo', () => f.selectionInfo())
    .with('fonts', () => f.fonts())
    .with('describe', () => JSON.stringify(f.describe()))
    .with('isEdited', () => JSON.stringify(f.isEdited()))
    .with('fileLayers', () => f.fileLayers())
    .exhaustive();
}

function bytes(request: Extract<PsdRequest, { kind: 'bytes' }>): Uint8Array {
  const f = openFile();
  const [a, b, c] = request.args;
  return match(request.method)
    .with('thumbnail', () => f.thumbnail(a ?? 0, b ?? 64))
    .with('maskThumbnail', () => f.maskThumbnail(a ?? 0, b ?? 64))
    .with('preview', () => f.preview(a ?? 256))
    .with('copyPixels', () => f.copyPixels(optional(a)))
    .with('exportPng', () => f.exportPng(optional(a)))
    .with('exportJpeg', () => f.exportJpeg(a ?? 90))
    .with('sample', () => f.sample(a ?? 0, b ?? 0, optional(c)))
    .exhaustive();
}

async function serve(request: PsdRequest) {
  switch (request.kind) {
    case 'open': {
      const wasm = await loadPsdEngineWasm();
      file?.free();
      file = undefined;
      trapped = false;
      file = new wasm.PsdFile(new Uint8Array(request.bytes));
      post({
        id: request.id,
        ok: true,
        kind: 'open',
        summary: JSON.parse(file.summary()),
        warnings: JSON.parse(file.warnings()),
      });
      return;
    }
    case 'blank': {
      const wasm = await loadPsdEngineWasm();
      postBytes(
        request.id,
        wasm.PsdFile.blank(request.width, request.height, request.white)
      );
      return;
    }
    case 'render':
      await render(request);
      return;
    case 'query':
      post({ id: request.id, ok: true, kind: 'json', json: query(request) });
      return;
    case 'bytes':
      postBytes(request.id, bytes(request));
      return;
    case 'edit': {
      const f = openFile();
      const json = match(request.action)
        .with('undo', () => f.undo())
        .with('redo', () => f.redo())
        .with('remote', () => f.applyCollab(request.changes ?? '[]'))
        .with('apply', () => f.apply(request.ops ?? '[]', request.coalesce))
        .exhaustive();
      post({ id: request.id, ok: true, kind: 'json', json });
      return;
    }
    case 'select':
      post({
        id: request.id,
        ok: true,
        kind: 'json',
        json: openFile().select(request.spec),
      });
      return;
    case 'placeImage':
      post({
        id: request.id,
        ok: true,
        kind: 'json',
        json: openFile().placeImage(
          new Uint8Array(request.bytes),
          request.name,
          optional(request.x),
          optional(request.y),
          optional(request.above)
        ),
      });
      return;
    case 'enableCollab':
      post({
        id: request.id,
        ok: true,
        kind: 'json',
        json: openFile().enableCollab(
          request.session,
          request.layers,
          request.seed
        ),
      });
      return;
    case 'collabChanges':
      post({
        id: request.id,
        ok: true,
        kind: 'json',
        json: openFile().collabChanges(),
      });
      return;
    case 'save': {
      const f = openFile();
      // Taken together, so the layers record matches the saved file.
      const saved = f.save().slice().buffer;
      const layers = f.fileLayers();
      post({ id: request.id, ok: true, kind: 'saved', bytes: saved, layers }, [
        saved,
      ]);
      return;
    }
    case 'registerFont': {
      // Fonts belong to the worker, so they can arrive before the document.
      const wasm = await loadPsdEngineWasm();
      const json = wasm.PsdFile.registerFont(
        new Uint8Array(request.bytes),
        request.family
      );
      post({ id: request.id, ok: true, kind: 'json', json });
      return;
    }
    case 'cancel':
      return;
  }
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

scope.addEventListener('message', (event: MessageEvent<PsdRequest>) => {
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
