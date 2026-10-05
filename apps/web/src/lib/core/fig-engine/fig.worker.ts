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
 *
 * A file opens with what its first page shows decoded; the worker decodes
 * the rest in slices while it is idle. Until then, requests that read only
 * an open page (renders, layers, hit tests) go ahead of reads that need the
 * whole file, which wait for those slices; a change to the file keeps the
 * order and decodes the rest at once.
 */

import { match } from 'ts-pattern';
import type { FigRequest, FigResponse, QueryMethod } from './protocol';
import { isWasmTrap, loadFigEngineWasm, type WasmFigFile } from './wasm-module';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let file: WasmFigFile | undefined;
let trapped = false;

type Render = Extract<FigRequest, { kind: 'render' }>;
const queries: Exclude<FigRequest, Render>[] = [];
const renders: Render[] = [];
let scheduled = false;
let busy = false;

/** Nodes decoded per idle slice (some tens of milliseconds on large files). */
const DECODE_SLICE = 2048;

/** Queries that read only a page, answered before the file is decoded. */
const PAGE_QUERIES = new Set<QueryMethod>([
  'summary',
  'layers',
  'rows',
  'hitTest',
  'ancestry',
  'geometry',
  'outline',
  'inRect',
  'layoutAids',
]);

const pageOnly = (r: FigRequest) =>
  r.kind === 'openPage' ||
  r.kind === 'thumbnail' ||
  (r.kind === 'query' && PAGE_QUERIES.has(r.method));

/**
 * Requests that only read the file; any other may change it (or depend on
 * the order of changes), so nothing is served ahead of it.
 */
const READS = new Set<FigRequest['kind']>([
  'query',
  'openPage',
  'render',
  'export',
  'exportFiles',
  'exportFramesPdf',
  'thumbnail',
  'copy',
  'save',
  'libraryPackage',
  'nodeThumbnail',
  'registerFont',
  'blank',
]);

const changesFile = (r: FigRequest) => !READS.has(r.kind);

const partlyDecoded = () =>
  file !== undefined && !trapped && !file.isComplete();

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
        case 'summary':
          json = f.summary();
          break;
        case 'components':
          json = f.components();
          break;
        case 'styles':
          json = f.styles();
          break;
        case 'variables':
          json = f.variables();
          break;
        case 'designInfo':
          json = f.designInfo(a as number, b as string);
          break;
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
        case 'pageColors':
          json = f.pageColors(a as number, b as number);
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
        case 'exportSvg':
          json = JSON.stringify(f.exportSvg(a as number, b as string));
          break;
        case 'fonts':
          json = f.fonts();
          break;
        case 'textGeometry':
          json = f.textGeometry(a as number, b as string);
          break;
        case 'vectorNetwork':
          json = f.vectorNetwork(a as number, b as string) ?? 'null';
          break;
        case 'prototype':
          json = f.prototype(a as number);
          break;
        case 'libraryStatus':
          json = f.libraryStatus();
          break;
        case 'libraryAssets':
          json = f.libraryAssets();
          break;
        case 'libraryUses':
          json = f.libraryUses();
          break;
        case 'layoutAids':
          json = f.layoutAids(a as number);
          break;
        case 'exportables':
          json = f.exportables(a as number, b as string);
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
    case 'exportFiles': {
      const file = openFile().exportFiles(request.page, request.request);
      const bytes = file.bytes.slice().buffer;
      const { name, mime } = file;
      file.free();
      post({ id: request.id, ok: true, kind: 'file', name, mime, bytes }, [
        bytes,
      ]);
      return;
    }
    case 'exportFramesPdf': {
      const bytes = openFile().exportFramesPdf(request.page).slice().buffer;
      const name = 'frames.pdf';
      post(
        {
          id: request.id,
          ok: true,
          kind: 'file',
          name,
          mime: 'application/pdf',
          bytes,
        },
        [bytes]
      );
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
    case 'edit': {
      const f = openFile();
      const json = match(request.action)
        .with('undo', () => f.undo(request.page))
        .with('redo', () => f.redo(request.page))
        .with('remote', () =>
          f.applyCollab(request.page, request.changes ?? '[]')
        )
        .with('apply', () =>
          f.apply(request.page, request.ops ?? '[]', request.coalesce)
        )
        .exhaustive();
      post({ id: request.id, ok: true, kind: 'edit', json });
      return;
    }
    case 'enableCollab': {
      const json = openFile().enableCollab(request.session, request.baseBlobs);
      post({ id: request.id, ok: true, kind: 'query', json });
      return;
    }
    case 'collabChanges': {
      const json = openFile().collabChanges();
      post({ id: request.id, ok: true, kind: 'query', json });
      return;
    }
    case 'addImage': {
      const json = openFile().addImage(
        request.hash,
        new Uint8Array(request.bytes)
      );
      post({ id: request.id, ok: true, kind: 'query', json });
      return;
    }
    case 'copy': {
      const copied = openFile().copy(request.page, request.ids);
      const document = copied.document.slice().buffer;
      const images = copied.images.slice().buffer;
      copied.free();
      post({ id: request.id, ok: true, kind: 'copied', document, images }, [
        document,
        images,
      ]);
      return;
    }
    case 'paste': {
      const json = openFile().paste(
        request.page,
        new Uint8Array(request.document),
        request.images ? new Uint8Array(request.images) : null,
        request.spec
      );
      post({ id: request.id, ok: true, kind: 'edit', json });
      return;
    }
    case 'libraryPackage': {
      const copied = openFile().libraryPackage(request.keys);
      const document = copied.document.slice().buffer;
      const images = copied.images.slice().buffer;
      copied.free();
      post({ id: request.id, ok: true, kind: 'copied', document, images }, [
        document,
        images,
      ]);
      return;
    }
    case 'importLibrary': {
      const json = openFile().importLibrary(
        request.page,
        new Uint8Array(request.document),
        request.images ? new Uint8Array(request.images) : null,
        request.spec
      );
      post({ id: request.id, ok: true, kind: 'edit', json });
      return;
    }
    case 'nodeThumbnail': {
      const png = openFile().nodeThumbnail(request.node, request.size);
      const bytes = png.length > 0 ? png.slice().buffer : null;
      post(
        { id: request.id, ok: true, kind: 'png', bytes },
        bytes ? [bytes] : []
      );
      return;
    }
    case 'registerFont': {
      // Fonts belong to the worker (every file it opens), so they can
      // arrive before the file.
      const wasm = await loadFigEngineWasm();
      const json = wasm.FigFile.registerFont(
        new Uint8Array(request.bytes),
        request.family ?? undefined
      );
      post({ id: request.id, ok: true, kind: 'query', json });
      return;
    }
    case 'blank': {
      const wasm = await loadFigEngineWasm();
      const bytes = wasm.FigFile.blank(request.name).slice().buffer;
      post({ id: request.id, ok: true, kind: 'saved', bytes }, [bytes]);
      return;
    }
    case 'save': {
      const bytes = openFile().save().slice().buffer;
      post({ id: request.id, ok: true, kind: 'saved', bytes }, [bytes]);
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

/** The request to serve next, or `decode` for a slice of the file. */
function next(): FigRequest | 'decode' | undefined {
  if (!partlyDecoded()) return queries.shift() ?? takeRender();
  // In order once a change waits: the first request that needs the whole
  // file decodes the rest.
  if (queries.some(changesFile)) return queries.shift();
  const local = queries.findIndex(pageOnly);
  if (local >= 0) return queries.splice(local, 1)[0];
  // Reads of the whole file wait for the slices; renders do not.
  return takeRender() ?? 'decode';
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    const request = next();
    if (!request) return;
    if (request === 'decode') {
      try {
        openFile().decodeSome(DECODE_SLICE);
      } catch (error) {
        // Decoding the rest failed: what needs it fails when served.
        if (isWasmTrap(error)) trapped = true;
      }
      return;
    }
    try {
      await serve(request);
    } catch (error) {
      fail(request.id, error);
    }
  } finally {
    busy = false;
    if (queries.length > 0 || renders.length > 0 || partlyDecoded()) schedule();
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
