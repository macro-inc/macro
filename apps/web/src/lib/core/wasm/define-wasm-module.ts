/**
 * The one loader for the first-party wasm modules in `apps/web/wasm-modules.json`.
 * Code imports a module as `wasm:<name>`; the `wasm:` Vite plugin
 * (`scripts/wasm-modules.ts`) turns that import into a `defineWasmModule` call.
 */
import { type Span, Telemetry } from '@macro-inc/observability';

/** Where the app runs a module, as `thread` in the manifest. */
export type WasmThread = 'main' | 'worker';

/** What every wasm-bindgen `--target web` glue exports to start an instance. */
interface WasmGlue {
  default(input: { module_or_path: WebAssembly.Module }): Promise<unknown>;
}

/** A load phase, for callers that report loads through their own telemetry. */
export interface WasmLoadPhase {
  phase: 'download' | 'compile';
  outcome: 'success' | 'error';
  durationMs: number;
  /** Bytes of the binary; set on a successful download. */
  bytes?: number;
}

export interface WasmCompileOptions {
  /** Told about each phase of a compile this call starts. */
  onPhase?: (phase: WasmLoadPhase) => void;
}

export interface WasmLoadOptions {
  /** A module compiled elsewhere, e.g. handed over by the page; skips the download. */
  module?: WebAssembly.Module;
}

export interface WasmModule<Glue> {
  readonly name: string;
  /** The binary's URL; it changes whenever the binary does. */
  readonly binaryUrl: string;
  /**
   * The started instance, shared by every caller in this context. A failed
   * load is tried again by the next call.
   */
  load(options?: WasmLoadOptions): Promise<Glue>;
  /** The compiled binary, for handing to workers. A failed compile is tried again. */
  compiled(options?: WasmCompileOptions): Promise<WebAssembly.Module>;
  /**
   * Drops the instance after a trap (a Rust panic can leave it unusable), so
   * the next `load` starts a fresh one with its own memory. Objects from the
   * old instance must not be used again.
   */
  discard(): void;
  /** The linear memory of the instance `load` started, until it is discarded. */
  memory(): WebAssembly.Memory | undefined;
}

/** What the `wasm:` plugin generates for a built module. */
export interface WasmModuleDefinition<Glue> {
  name: string;
  thread: WasmThread;
  /** Off under Vitest, whose test environments are not workers. */
  checkThread: boolean;
  binaryUrl: string;
  /** The glue, wrapped by the plugin so that each call makes a fresh copy of its state. */
  glue: () => Promise<{ instantiateGlue: (binaryUrl: string) => Glue }>;
}

export function defineWasmModule<Glue extends WasmGlue>(
  definition: WasmModuleDefinition<Glue>
): WasmModule<Glue> {
  let compiling: Promise<WebAssembly.Module> | undefined;
  let loading: Promise<Glue> | undefined;
  let memory: WebAssembly.Memory | undefined;
  let generation = 0;

  const compiled = (
    options?: WasmCompileOptions
  ): Promise<WebAssembly.Module> => {
    if (compiling) return compiling;

    // Nothing replaces `compiling` while it is in flight.
    compiling = (async () => {
      try {
        return await Telemetry.span('wasm.compile_module', (span) => {
          span.setAttr('wasm.module', definition.name);
          return compileBinary(definition, span, options?.onPhase);
        });
      } catch (error) {
        compiling = undefined;
        throw error;
      }
    })();
    return compiling;
  };

  const load = (options?: WasmLoadOptions): Promise<Glue> => {
    if (loading) return loading;

    if (definition.checkThread && definition.thread === 'worker') {
      if (!inWorker()) {
        return Promise.reject(
          new Error(
            `${definition.name} runs in a worker (thread in wasm-modules.json); hand compiled() to one instead of loading it here`
          )
        );
      }
    }

    // `discard` moves to a new instance while this one may still be starting.
    const instance = ++generation;
    loading = (async () => {
      try {
        const started = await Telemetry.span('wasm.load', (span) =>
          instantiate(definition, span, options?.module ?? compiled)
        );
        if (generation === instance) memory = started.memory;
        return started.glue;
      } catch (error) {
        if (generation === instance) loading = undefined;
        throw error;
      }
    })();
    return loading;
  };

  return {
    name: definition.name,
    binaryUrl: definition.binaryUrl,
    load,
    compiled,
    discard: () => {
      generation++;
      loading = undefined;
      memory = undefined;
    },
    memory: () => memory,
  };
}

/**
 * What the `wasm:` plugin generates outside a production build when the
 * module's package has not been built: every load fails with how to build it.
 */
export function missingWasmModule<Glue>(
  name: string,
  message: string
): WasmModule<Glue> {
  const fail = () => Promise.reject(new Error(message));
  return {
    name,
    binaryUrl: '',
    load: fail,
    compiled: fail,
    discard: () => {},
    memory: () => undefined,
  };
}

/**
 * Downloads and compiles the binary. Compilation streams while the bytes
 * arrive, so the compile span starts with the response and overlaps the
 * download span, which ends with the last byte.
 */
async function compileBinary(
  definition: WasmModuleDefinition<unknown>,
  span: Span,
  onPhase: ((phase: WasmLoadPhase) => void) | undefined
): Promise<WebAssembly.Module> {
  const download = trackDownload(span, onPhase);

  let response: Response;
  try {
    response = await fetch(definition.binaryUrl);
    if (!response.ok) {
      throw new Error(
        `${definition.name} wasm download returned HTTP ${response.status}`
      );
    }
  } catch (error) {
    download.failed(error);
    throw error;
  }

  const compileStartedAt = performance.now();
  const compiling = span.span('wasm.compile');
  try {
    const module = await compileResponse(response, download.downloaded);
    onPhase?.({
      phase: 'compile',
      outcome: 'success',
      durationMs: performance.now() - compileStartedAt,
    });
    return module;
  } catch (error) {
    // A body that broke off mid-stream fails the compile.
    if (!download.ended()) download.failed(error);
    compiling.error(error);
    onPhase?.({
      phase: 'compile',
      outcome: 'error',
      durationMs: performance.now() - compileStartedAt,
    });
    throw error;
  } finally {
    compiling.end();
  }
}

/**
 * The download span and phase. Made apart from the response: the body
 * stream's callbacks reach `downloaded`, and WebKit never collects a stream
 * whose callbacks can reach it.
 */
function trackDownload(
  span: Span,
  onPhase: ((phase: WasmLoadPhase) => void) | undefined
) {
  const downloadSpan = span.span('wasm.download');
  const startedAt = performance.now();
  let ended = false;

  return {
    ended: () => ended,
    failed: (error: unknown) => {
      ended = true;
      downloadSpan.error(error);
      downloadSpan.end();
      onPhase?.({
        phase: 'download',
        outcome: 'error',
        durationMs: performance.now() - startedAt,
      });
    },
    downloaded: (bytes: number) => {
      ended = true;
      downloadSpan.setAttr('wasm.bytes', bytes);
      downloadSpan.end();
      onPhase?.({
        phase: 'download',
        outcome: 'success',
        durationMs: performance.now() - startedAt,
        bytes,
      });
    },
  };
}

async function compileResponse(
  response: Response,
  downloaded: (bytes: number) => void
): Promise<WebAssembly.Module> {
  // Some desktop protocols do not serve the application/wasm MIME type,
  // which streaming compilation requires.
  const mime = response.headers.get('content-type')?.split(';')[0];
  const body = mime === 'application/wasm' ? response.body : null;

  if (!body) {
    const bytes = await response.arrayBuffer();
    downloaded(bytes.byteLength);
    return WebAssembly.compile(bytes);
  }

  const counted = body.pipeThrough(countBytes(downloaded));
  return WebAssembly.compileStreaming(
    new Response(counted, { headers: response.headers })
  );
}

/** Passes the body through, reporting its length at the end. */
function countBytes(
  downloaded: (bytes: number) => void
): TransformStream<Uint8Array, Uint8Array> {
  let bytes = 0;
  return new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      downloaded(bytes);
    },
  });
}

async function instantiate<Glue extends WasmGlue>(
  definition: WasmModuleDefinition<Glue>,
  span: Span,
  source: WebAssembly.Module | (() => Promise<WebAssembly.Module>)
): Promise<{ glue: Glue; memory: WebAssembly.Memory | undefined }> {
  span.setAttr('wasm.module', definition.name);
  span.setAttr('wasm.thread', definition.thread);
  span.setAttr('wasm.provided_module', typeof source !== 'function');

  const module = typeof source === 'function' ? await source() : source;
  return span.span('wasm.instantiate', async () => {
    // A fresh copy of the glue per instance: its memory views and
    // finalizers live in the glue's own state.
    const { instantiateGlue } = await definition.glue();
    const glue = instantiateGlue(definition.binaryUrl);
    const exports = await glue.default({ module_or_path: module });
    return { glue, memory: exportedMemory(exports) };
  });
}

function exportedMemory(exports: unknown): WebAssembly.Memory | undefined {
  if (typeof exports !== 'object' || exports === null) return undefined;
  if (!('memory' in exports)) return undefined;
  return exports.memory instanceof WebAssembly.Memory
    ? exports.memory
    : undefined;
}

function inWorker(): boolean {
  return (
    typeof WorkerGlobalScope !== 'undefined' &&
    globalThis instanceof WorkerGlobalScope
  );
}
