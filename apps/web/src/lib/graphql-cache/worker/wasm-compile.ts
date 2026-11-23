import cacheWasm from 'wasm:cache-wasm';
import type { WasmLoadPhase } from '@core/wasm/define-wasm-module';
import type { CacheTelemetryRecorderLike } from '../telemetry';

type Telemetry = Pick<CacheTelemetryRecorderLike, 'record'>;

/**
 * Downloads and compiles the cache engine binary through the shared loader,
 * reporting each phase as the cache's `graphql_cache.wasm_download` and
 * `wasm_compile`. The loader streams a binary served as `application/wasm`,
 * so `wasm_download` then times the response's arrival and has no `bytes`,
 * and `wasm_compile` times the body and the compile together. A streamed
 * compile that fails for any reason but an invalid binary is reported as a
 * failed download and retried once from bytes. Nothing keeps the module: the
 * caller hands it on or drops it.
 */
export function compileCacheWasm(
  telemetry: Telemetry
): Promise<WebAssembly.Module> {
  return cacheWasm.compile({
    onPhase: (phase) => telemetry.record(cacheLoadObservation(phase)),
  });
}

function cacheLoadObservation(phase: WasmLoadPhase) {
  const succeeded = phase.outcome === 'success';
  if (phase.phase === 'download') {
    return {
      name: 'graphql_cache.wasm_download' as const,
      operationCategory: 'initialization' as const,
      outcome: phase.outcome,
      errorCode: succeeded ? ('none' as const) : ('wasm-download' as const),
      durationMs: phase.durationMs,
      ...(phase.bytes === undefined ? {} : { bytes: phase.bytes }),
    };
  }
  return {
    name: 'graphql_cache.wasm_compile' as const,
    operationCategory: 'initialization' as const,
    outcome: phase.outcome,
    errorCode: succeeded ? ('none' as const) : ('wasm-compile' as const),
    durationMs: phase.durationMs,
  };
}
