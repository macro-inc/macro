/**
 * Loads the production cache engine (the cache-wasm build in `../wasm`) in a
 * test process, with the same contract as `loadCacheWasm`, and counts every
 * call made into it.
 *
 * Build the module first: `just build-cache-wasm` from `apps/web`.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  CacheEngine,
  CacheOpenResult,
  CacheWasmModule,
} from '../worker/wasm-module';

// Paths, not `new URL(..., import.meta.url)`: Vite rewrites that pattern into
// a served asset URL, which the Node loader refuses.
const WASM_DIR = join(dirname(fileURLToPath(import.meta.url)), '../wasm');
const WASM_JS = join(WASM_DIR, 'cache_wasm.js');
const WASM_BINARY = join(WASM_DIR, 'cache_wasm_bg.wasm');

/** One call into the engine. */
export type EngineCall = { method: string };

/** Every engine method call, in order. */
export type EngineCallLog = {
  calls: EngineCall[];
  /** Calls by method name since `mark` was last taken. */
  countsSince(mark: number): Record<string, number>;
  mark(): number;
};

export function createEngineCallLog(): EngineCallLog {
  const calls: EngineCall[] = [];
  return {
    calls,
    mark: () => calls.length,
    countsSince: (mark) => {
      const counts: Record<string, number> = {};
      for (const { method } of calls.slice(mark))
        counts[method] = (counts[method] ?? 0) + 1;
      return counts;
    },
  };
}

/** The engine with every method call recorded. Methods the worker core only
 * feature-checks (`engine.prepareHydrate?.`) keep their presence. */
function recordedEngine(engine: CacheEngine, log: EngineCallLog): CacheEngine {
  return new Proxy(engine, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string')
        return value;
      return (...args: unknown[]) => {
        log.calls.push({ method: property });
        return Reflect.apply(value, target, args);
      };
    },
  });
}

let compiled: Promise<WebAssembly.Module> | undefined;

function compileEngine(): Promise<WebAssembly.Module> {
  compiled ??= (async () => {
    const bytes = await readFile(WASM_BINARY).catch((error: unknown) => {
      throw new Error(
        `the cache engine is not built (${WASM_BINARY}); run \`just build-cache-wasm\` in apps/web`,
        { cause: error }
      );
    });
    return await WebAssembly.compile(bytes);
  })();
  return compiled;
}

export type RealCacheWasm = {
  module: CacheWasmModule;
  log: EngineCallLog;
  /** SQL the engine ran since it loaded. */
  sqlCounters(): SqlCounters;
  /** The engine's current linear memory, as `cacheWasmLinearMemoryBytes`. */
  linearMemoryBytes(): number;
  /** Executions the engine reported as slow (over 200 ms), in order. */
  slowQueries: SlowQuery[];
};

/** Statements executed and rows they stepped, counted inside the engine. */
export type SqlCounters = { statements: number; rows: number };

export type SlowQuery = {
  fingerprint: string;
  durationMs: number;
  success: boolean;
};

type CountingGlue = CacheWasmModule & {
  sqlCounters?: () => SqlCounters;
};

type EngineExports = { memory?: unknown };

let loaded: Promise<RealCacheWasm> | undefined;

/**
 * Loads and initializes the engine once per test file's module graph, as
 * `loadCacheWasm` does in a worker: the linear memory must be exported and the
 * slow-query callback is installed. Every open hands out a recorded engine.
 */
export function loadRealCacheWasm(): Promise<RealCacheWasm> {
  loaded ??= initialize();
  return loaded;
}

async function initialize(): Promise<RealCacheWasm> {
  const glue = (await import(
    /* @vite-ignore */ pathToFileURL(WASM_JS).href
  )) as CountingGlue;
  const exports = (await glue.default({
    module_or_path: await compileEngine(),
  })) as EngineExports;
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory))
    throw new Error('cache WASM did not export its linear memory');
  const readSqlCounters = glue.sqlCounters;
  if (!readSqlCounters)
    throw new Error(
      'the cache engine build has no sqlCounters; rebuild it with `just build-cache-wasm` in apps/web'
    );
  const slowQueries: SlowQuery[] = [];
  glue.setSlowQueryCallback?.((fingerprint, durationMs, success) => {
    slowQueries.push({ fingerprint, durationMs, success });
  });
  const log = createEngineCallLog();
  const wrapOpen =
    (
      open: (...args: never[]) => Promise<CacheOpenResult>
    ): ((...args: never[]) => Promise<CacheOpenResult>) =>
    async (...args) => {
      const opened = await open(...args);
      return { ...opened, engine: recordedEngine(opened.engine, log) };
    };
  const module: CacheWasmModule = {
    ...glue,
    default: glue.default,
    openCache: async (scope, hotCapacity) =>
      recordedEngine(await glue.openCache(scope, hotCapacity), log),
    openCacheForRecovery: async (scope, hotCapacity) =>
      recordedEngine(await glue.openCacheForRecovery(scope, hotCapacity), log),
    openCacheWithOutcome: glue.openCacheWithOutcome
      ? (wrapOpen(
          glue.openCacheWithOutcome.bind(glue) as never
        ) as CacheWasmModule['openCacheWithOutcome'])
      : undefined,
    openCacheForRecoveryWithOutcome: glue.openCacheForRecoveryWithOutcome
      ? (wrapOpen(
          glue.openCacheForRecoveryWithOutcome.bind(glue) as never
        ) as CacheWasmModule['openCacheForRecoveryWithOutcome'])
      : undefined,
  };
  return {
    module,
    log,
    sqlCounters: () => {
      const { statements, rows } = readSqlCounters();
      return { statements: Number(statements), rows: Number(rows) };
    },
    linearMemoryBytes: () => memory.buffer.byteLength,
    slowQueries,
  };
}
