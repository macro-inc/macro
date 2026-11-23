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
  /** Bytes of the binary; set on a successful download read whole, not streamed. */
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
   * A compile of its own, kept by no one here: for a module the caller may
   * drop, such as one compiled ahead for a worker that might never start.
   */
  compile(options?: WasmCompileOptions): Promise<WebAssembly.Module>;
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

  const compile = (options?: WasmCompileOptions): Promise<WebAssembly.Module> =>
    Telemetry.span('wasm.compile_module', (span) => {
      span.setAttr('wasm.module', definition.name);
      return compileBinary(definition, span, options?.onPhase);
    });

  const compiled = (
    options?: WasmCompileOptions
  ): Promise<WebAssembly.Module> => {
    if (compiling) return compiling;

    // Nothing replaces `compiling` while it is in flight.
    compiling = (async () => {
      try {
        return await compile(options);
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
    compile,
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
    compile: fail,
    discard: () => {},
    memory: () => undefined,
  };
}

type Streamed = { stream: Response };
type Bytes = { bytes: ArrayBuffer };
type OnPhase = ((phase: WasmLoadPhase) => void) | undefined;

/**
 * Downloads and compiles the binary. A response served as exactly
 * `application/wasm` compiles from its stream, as it arrives: only a module
 * compiled from the fetched response itself has its optimized code cached
 * by Chromium for the next page load. Streamed, the download phase ends with
 * the response's arrival and has no `bytes`, and the compile phase includes
 * the body. A streamed compile that fails for any reason but an invalid
 * binary (a dropped body, a runtime that won't stream this response) is
 * reported as a failed download and retried once from bytes.
 */
async function compileBinary(
  definition: WasmModuleDefinition<unknown>,
  span: Span,
  onPhase: OnPhase
): Promise<WebAssembly.Module> {
  const body = await download<Streamed | Bytes>(
    definition,
    span,
    onPhase,
    (response) =>
      canCompileStreaming(response) ? { stream: response } : readBytes(response)
  );
  if ('bytes' in body) {
    return compilePhase(span, onPhase, () => WebAssembly.compile(body.bytes));
  }
  try {
    return await compilePhase(span, onPhase, () =>
      WebAssembly.compileStreaming(body.stream)
    );
  } catch (error) {
    if (error instanceof WebAssembly.CompileError) throw error;
  }
  const { bytes } = await download(definition, span, onPhase, readBytes);
  return compilePhase(span, onPhase, () => WebAssembly.compile(bytes));
}

function canCompileStreaming(response: Response): boolean {
  // Exactly: some runtimes reject parameters or other casing mid-compile.
  return (
    typeof WebAssembly.compileStreaming === 'function' &&
    response.headers.get('content-type') === 'application/wasm'
  );
}

const readBytes = async (response: Response): Promise<Bytes> => ({
  bytes: await response.arrayBuffer(),
});

async function download<Body extends Streamed | Bytes>(
  definition: WasmModuleDefinition<unknown>,
  span: Span,
  onPhase: OnPhase,
  read: (response: Response) => Body | Promise<Body>
): Promise<Body> {
  const downloading = span.span('wasm.download');
  const startedAt = performance.now();
  try {
    const response = await fetch(definition.binaryUrl);
    if (!response.ok) {
      throw new Error(
        `${definition.name} wasm download returned HTTP ${response.status}`
      );
    }
    const body = await read(response);
    const bytes = 'bytes' in body ? body.bytes.byteLength : undefined;
    if (bytes !== undefined) downloading.setAttr('wasm.bytes', bytes);
    onPhase?.({
      phase: 'download',
      outcome: 'success',
      durationMs: performance.now() - startedAt,
      ...(bytes === undefined ? {} : { bytes }),
    });
    return body;
  } catch (error) {
    downloading.error(error);
    onPhase?.({
      phase: 'download',
      outcome: 'error',
      durationMs: performance.now() - startedAt,
    });
    throw error;
  } finally {
    downloading.end();
  }
}

async function compilePhase(
  span: Span,
  onPhase: OnPhase,
  source: () => Promise<WebAssembly.Module>
): Promise<WebAssembly.Module> {
  const compiling = span.span('wasm.compile');
  const startedAt = performance.now();
  try {
    const module = await source();
    onPhase?.({
      phase: 'compile',
      outcome: 'success',
      durationMs: performance.now() - startedAt,
    });
    return module;
  } catch (error) {
    compiling.error(error);
    // Streamed, only a CompileError is the binary's fault; anything else is
    // the body or the runtime refusing to stream it.
    onPhase?.({
      phase: error instanceof WebAssembly.CompileError ? 'compile' : 'download',
      outcome: 'error',
      durationMs: performance.now() - startedAt,
    });
    throw error;
  } finally {
    compiling.end();
  }
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
