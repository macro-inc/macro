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

/** Bound background work so hit tests can run between decode slices. */
const DECODE_BUDGET_MS = 8;
let decodeSlice = 128;

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
  'liftPlan',
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
channel.port1.onmessage = async () => {
  scheduled = false;
  try {
    await pump();
  } catch (error: unknown) {
    // pump reports each request's failure itself; this is only a failed report.
    console.error('[fig-engine] worker could not report a failure', error);
  }
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
  const matchRemainingServe1 = async () =>
    match(request)
      .with({ kind: 'copy' }, async (request) => {
        {
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
      })
      .with({ kind: 'paste' }, async (request) => {
        {
          const json = openFile().paste(
            request.page,
            new Uint8Array(request.document),
            request.images ? new Uint8Array(request.images) : null,
            request.spec
          );
          post({ id: request.id, ok: true, kind: 'edit', json });
          return;
        }
      })
      .with({ kind: 'libraryPackage' }, async (request) => {
        {
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
      })
      .with({ kind: 'importLibrary' }, async (request) => {
        {
          const json = openFile().importLibrary(
            request.page,
            new Uint8Array(request.document),
            request.images ? new Uint8Array(request.images) : null,
            request.spec
          );
          post({ id: request.id, ok: true, kind: 'edit', json });
          return;
        }
      })
      .with({ kind: 'nodeThumbnail' }, async (request) => {
        {
          const png = openFile().nodeThumbnail(request.node, request.size);
          const bytes = png.length > 0 ? png.slice().buffer : null;
          post(
            { id: request.id, ok: true, kind: 'png', bytes },
            bytes ? [bytes] : []
          );
          return;
        }
      })
      .with({ kind: 'registerFont' }, async (request) => {
        {
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
      })
      .with({ kind: 'blank' }, async (request) => {
        {
          const wasm = await loadFigEngineWasm(request.module);
          const bytes = wasm.FigFile.blank(request.name).slice().buffer;
          post({ id: request.id, ok: true, kind: 'saved', bytes }, [bytes]);
          return;
        }
      })
      .with({ kind: 'save' }, async (request) => {
        {
          const bytes = openFile().save().slice().buffer;
          post({ id: request.id, ok: true, kind: 'saved', bytes }, [bytes]);
          return;
        }
      })
      .with({ kind: 'cancel' }, async () => {
        return;
      })
      .otherwise(async () => {});
  return await match(request)
    .with({ kind: 'open' }, async (request) => {
      {
        const wasm = await loadFigEngineWasm(request.module);
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
    })
    .with({ kind: 'openPage' }, async (request) => {
      post({
        id: request.id,
        ok: true,
        kind: 'openPage',
        layout: JSON.parse(openFile().openPage(request.page)),
      });
      return;
    })
    .with({ kind: 'render' }, async (request) => {
      {
        const started = performance.now();
        const pixels = openFile().render(
          request.page,
          request.x,
          request.y,
          request.scale,
          request.width,
          request.height,
          request.outline,
          request.layers
        );
        // Straight alpha, as ImageData holds it: tiles drawn on the page
        // color are opaque, and the engine unpremultiplies the others.
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
    })
    .with({ kind: 'query' }, async (request) => {
      {
        const f = openFile();
        const [a, b, c, d, e, g] = request.args;

        const json = match(request)
          .with({ method: 'summary' }, () => {
            return f.summary();
          })
          .with({ method: 'components' }, () => {
            return f.components();
          })
          .with({ method: 'styles' }, () => {
            return f.styles();
          })
          .with({ method: 'variables' }, () => {
            return f.variables();
          })
          .with({ method: 'designInfo' }, () => {
            return f.designInfo(a as number, b as string);
          })
          .with({ method: 'layers' }, () => {
            return f.layers(a as number, (b as string | null) ?? undefined);
          })
          .with({ method: 'rows' }, () => {
            return f.rows(a as number, b as string);
          })
          .with({ method: 'nodeInfo' }, () => {
            return f.nodeInfo(a as number, b as string);
          })
          .with({ method: 'hitTest' }, () => {
            return f.hitTest(
              a as number,
              b as number,
              c as number,
              d as number
            );
          })
          .with({ method: 'ancestry' }, () => {
            return f.ancestry(a as number, b as string);
          })
          .with({ method: 'geometry' }, () => {
            return f.geometry(a as number, b as string);
          })
          .with({ method: 'outline' }, () => {
            return JSON.stringify(f.outline(a as number, b as string));
          })

          .with({ method: 'search' }, () => {
            return f.search(a as number, b as string, c as number);
          })
          .with({ method: 'pageColors' }, () => {
            return f.pageColors(a as number, b as number);
          })
          .with({ method: 'inRect' }, () => {
            return f.inRect(
              a as number,
              (b as string | null) ?? undefined,
              c as number,
              d as number,
              e as number,
              g as number
            );
          })
          .with({ method: 'exportSvg' }, () => {
            return JSON.stringify(f.exportSvg(a as number, b as string));
          })
          .with({ method: 'fonts' }, () => {
            return f.fonts();
          })
          .with({ method: 'textGeometry' }, () => {
            return f.textGeometry(a as number, b as string);
          })
          .with({ method: 'vectorNetwork' }, () => {
            return f.vectorNetwork(a as number, b as string) ?? 'null';
          })
          .with({ method: 'prototype' }, () => {
            return f.prototype(a as number);
          })
          .with({ method: 'libraryStatus' }, () => {
            return f.libraryStatus();
          })
          .with({ method: 'libraryAssets' }, () => {
            return f.libraryAssets();
          })
          .with({ method: 'libraryUses' }, () => {
            return f.libraryUses();
          })
          .with({ method: 'layoutAids' }, () => {
            return f.layoutAids(a as number);
          })

          .with({ method: 'exportables' }, () => {
            return f.exportables(a as number, b as string);
          })
          .with({ method: 'liftPlan' }, () => {
            return f.liftPlan(a as number, b as string);
          })
          .exhaustive(() => undefined);
        if (json === undefined) {
          fail(request.id, `unknown query method: ${request.method}`);
          return;
        }
        post({ id: request.id, ok: true, kind: 'query', json });
        return;
      }
    })
    .with({ kind: 'export' }, async (request) => {
      {
        const png = openFile().exportPng(
          request.page,
          request.node,
          request.scale
        );
        const bytes = png.slice().buffer;
        post({ id: request.id, ok: true, kind: 'png', bytes }, [bytes]);
        return;
      }
    })
    .with({ kind: 'exportFiles' }, async (request) => {
      {
        const file = openFile().exportFiles(request.page, request.request);
        const bytes = file.bytes.slice().buffer;
        const { name, mime } = file;
        file.free();
        post({ id: request.id, ok: true, kind: 'file', name, mime, bytes }, [
          bytes,
        ]);
        return;
      }
    })
    .with({ kind: 'exportFramesPdf' }, async (request) => {
      {
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
    })
    .with({ kind: 'thumbnail' }, async (request) => {
      {
        const png = openFile().thumbnail();
        const bytes = png ? png.slice().buffer : null;
        post(
          { id: request.id, ok: true, kind: 'png', bytes },
          bytes ? [bytes] : []
        );
        return;
      }
    })
    .with({ kind: 'edit' }, async (request) => {
      {
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
          .exhaustive(() => undefined);
        if (json === undefined) {
          fail(request.id, `unknown edit action: ${request.action}`);
          return;
        }
        post({ id: request.id, ok: true, kind: 'edit', json });
        return;
      }
    })
    .with({ kind: 'enableCollab' }, async (request) => {
      {
        const json = openFile().enableCollab(
          request.session,
          request.baseBlobs
        );
        post({ id: request.id, ok: true, kind: 'query', json });
        return;
      }
    })
    .with({ kind: 'collabChanges' }, async (request) => {
      {
        const json = openFile().collabChanges();
        post({ id: request.id, ok: true, kind: 'query', json });
        return;
      }
    })
    .with({ kind: 'addImage' }, async (request) => {
      {
        const json = openFile().addImage(
          request.hash,
          new Uint8Array(request.bytes)
        );
        post({ id: request.id, ok: true, kind: 'query', json });
        return;
      }
    })
    .otherwise(matchRemainingServe1);
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
        const started = performance.now();
        openFile().decodeSome(decodeSlice);
        const elapsed = Math.max(1, performance.now() - started);
        decodeSlice = Math.max(
          32,
          Math.min(
            2048,
            Math.round(decodeSlice * Math.min(2, DECODE_BUDGET_MS / elapsed))
          )
        );
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
