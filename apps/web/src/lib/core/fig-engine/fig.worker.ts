/// <reference lib="webworker" />

/**
 * Hosts the `.fig` engine (Rust compiled to wasm) off the main thread: one
 * worker per open file. Parsing, instance expansion, rasterization, hit
 * testing, and inspection all happen here; rendered tiles go back as
 * transferable `ImageBitmap`s.
 *
 * Requests are queued and served one at a time: queries first, in arrival
 * order, then renders by priority. Renders not yet started can be
 * cancelled.
 */

import type { FigRequest, FigResponse } from './protocol';
import { isWasmTrap, loadFigEngineWasm, type WasmFigFile } from './wasm-module';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let file: WasmFigFile | undefined;
let trapped = false;

type Render = Extract<FigRequest, { kind: 'render' }>;
const queries: Exclude<FigRequest, Render>[] = [];
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

function post(response: FigResponse, transfer: Transferable[] = []) {
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

function openFile(): WasmFigFile {
  if (trapped) throw new Error('the engine stopped after an internal error');
  if (!file) throw new Error('no file is open');
  return file;
}

async function serve(request: FigRequest) {
  switch (request.kind) {
    case 'open': {
      const wasm = await loadFigEngineWasm();
      file?.free();
      file = new wasm.FigFile(new Uint8Array(request.bytes));
      post({
        id: request.id,
        ok: true,
        kind: 'open',
        summary: JSON.parse(file.summary()),
      });
      return;
    }
    case 'openPage':
      post({
        id: request.id,
        ok: true,
        kind: 'openPage',
        layout: JSON.parse(openFile().openPage(request.page)),
      });
      return;
    case 'render': {
      const started = performance.now();
      const pixels = openFile().render(
        request.page,
        request.x,
        request.y,
        request.scale,
        request.width,
        request.height,
        request.outline
      );
      // Tiles are opaque (drawn on the page color), so premultiplied and
      // straight alpha agree.
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
      return;
    }
    case 'query': {
      const f = openFile();
      const [a, b, c, d, e, g] = request.args;
      let json: string;
      switch (request.method) {
        case 'layers':
          json = f.layers(a as number, (b as string | null) ?? undefined);
          break;
        case 'rows':
          json = f.rows(a as number, b as string);
          break;
        case 'nodeInfo':
          json = f.nodeInfo(a as number, b as string);
          break;
        case 'hitTest':
          json = f.hitTest(a as number, b as number, c as number, d as number);
          break;
        case 'ancestry':
          json = f.ancestry(a as number, b as string);
          break;
        case 'geometry':
          json = f.geometry(a as number, b as string);
          break;
        case 'outline':
          json = JSON.stringify(f.outline(a as number, b as string));
          break;
        case 'search':
          json = f.search(a as number, b as string, c as number);
          break;
        case 'inRect':
          json = f.inRect(
            a as number,
            (b as string | null) ?? undefined,
            c as number,
            d as number,
            e as number,
            g as number
          );
          break;
      }
      post({ id: request.id, ok: true, kind: 'query', json });
      return;
    }
    case 'export': {
      const png = openFile().exportPng(
        request.page,
        request.node,
        request.scale
      );
      const bytes = png.slice().buffer;
      post({ id: request.id, ok: true, kind: 'png', bytes }, [bytes]);
      return;
    }
    case 'thumbnail': {
      const png = openFile().thumbnail();
      const bytes = png ? png.slice().buffer : null;
      post(
        { id: request.id, ok: true, kind: 'png', bytes },
        bytes ? [bytes] : []
      );
      return;
    }
    case 'cancel':
      return;
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    let next: FigRequest | undefined = queries.shift();
    if (!next && renders.length > 0) {
      let best = 0;
      for (let i = 1; i < renders.length; i++) {
        if (renders[i].priority < renders[best].priority) best = i;
      }
      next = renders.splice(best, 1)[0];
    }
    if (!next) return;
    try {
      await serve(next);
    } catch (error) {
      fail(next.id, error);
    }
  } finally {
    busy = false;
    if (queries.length > 0 || renders.length > 0) schedule();
  }
}

scope.addEventListener('message', (event: MessageEvent<FigRequest>) => {
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
