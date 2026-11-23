import type { CacheTelemetryRecorderLike } from '../telemetry';

type Telemetry = Pick<CacheTelemetryRecorderLike, 'record'>;

/**
 * Compiles from the response stream when the server labels the binary as
 * WASM. Chromium then keeps the module's compiled code with the cached
 * response, so the next page load starts from optimized code instead of
 * compiling it again; a module compiled from bytes is never cached.
 */
function canCompileStreaming(response: Response): boolean {
  // Exactly: some runtimes reject parameters or other casing mid-compile.
  return (
    typeof WebAssembly.compileStreaming === 'function' &&
    response.headers.get('content-type') === 'application/wasm'
  );
}

type Streamed = { stream: Response };
type Bytes = { bytes: ArrayBuffer };

const readBytes = async (response: Response): Promise<Bytes> => ({
  bytes: await response.arrayBuffer(),
});

async function download<Body extends Streamed | Bytes>(
  url: URL,
  read: (response: Response) => Body | Promise<Body>,
  telemetry: Telemetry,
  now: () => number
): Promise<Body> {
  const startedAt = now();
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`cache WASM download returned HTTP ${response.status}`);
    }
    const body = await read(response);
    telemetry.record({
      name: 'graphql_cache.wasm_download',
      operationCategory: 'initialization',
      outcome: 'success',
      errorCode: 'none',
      durationMs: now() - startedAt,
      ...('bytes' in body ? { bytes: body.bytes.byteLength } : {}),
    });
    return body;
  } catch (error) {
    telemetry.record({
      name: 'graphql_cache.wasm_download',
      operationCategory: 'initialization',
      outcome: 'error',
      errorCode: 'wasm-download',
      durationMs: now() - startedAt,
    });
    throw error;
  }
}

async function compile(
  source: () => Promise<WebAssembly.Module>,
  telemetry: Telemetry,
  now: () => number
): Promise<WebAssembly.Module> {
  const startedAt = now();
  try {
    const compiled = await source();
    telemetry.record({
      name: 'graphql_cache.wasm_compile',
      operationCategory: 'initialization',
      outcome: 'success',
      errorCode: 'none',
      durationMs: now() - startedAt,
    });
    return compiled;
  } catch (error) {
    // Streamed, only a CompileError is the binary's fault; anything else is
    // the body or the runtime refusing to stream it.
    const compileFailed = error instanceof WebAssembly.CompileError;
    telemetry.record({
      name: compileFailed
        ? 'graphql_cache.wasm_compile'
        : 'graphql_cache.wasm_download',
      operationCategory: 'initialization',
      outcome: 'error',
      errorCode: compileFailed ? 'wasm-compile' : 'wasm-download',
      durationMs: now() - startedAt,
    });
    throw error;
  }
}

/**
 * Downloads and compiles the cache engine binary. Streamed, the download and
 * the compile overlap: `wasm_download` then times the response's arrival and
 * has no `bytes`, and `wasm_compile` times the body and the compile together.
 * A streamed compile that fails for any reason but an invalid binary (a
 * dropped body, a runtime that won't stream this response) is reported as a
 * failed download and retried once from bytes, as before streaming.
 */
export async function compileCacheWasm(
  url: URL,
  telemetry: Telemetry,
  now: () => number
): Promise<WebAssembly.Module> {
  const body = await download<Streamed | Bytes>(
    url,
    (response) =>
      canCompileStreaming(response)
        ? { stream: response }
        : readBytes(response),
    telemetry,
    now
  );
  if ('bytes' in body) {
    return compile(() => WebAssembly.compile(body.bytes), telemetry, now);
  }
  try {
    return await compile(
      () => WebAssembly.compileStreaming(body.stream),
      telemetry,
      now
    );
  } catch (error) {
    if (error instanceof WebAssembly.CompileError) throw error;
  }
  const { bytes } = await download(url, readBytes, telemetry, now);
  return compile(() => WebAssembly.compile(bytes), telemetry, now);
}
