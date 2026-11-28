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

/** One call into the engine: its method, the view it reads for (see
 * `VIEW_READS`), and, once it settles, how many records it handed back to the
 * worker (0 when it failed, with the reason in `error`). */
export type EngineCall = {
  method: string;
  view?: string;
  recordsOut?: number;
  error?: string;
};

/** Reads made for views in some steps: how many views were read, and how many
 * reads repeated a view already read in them. */
export type ViewReads = { views: number; repeats: number; maxPerView: number };

/** The engine methods that read for one view, and what names the view: the
 * query and its variables, or the whole request (a search without its clock).
 * Two calls with the same key read the same view again. */
const VIEW_READS = new Map<string, (args: unknown[]) => unknown>([
  ['readQuery', (args) => [args[1], args[3]]],
  ['watchQuery', (args) => [args[1], args[3]]],
  ['entityFilter', (args) => args[0]],
  ['search', (args) => withoutClock(args[0])],
  ['readRecordsByKeys', (args) => [args[0], args[1], args[2]]],
]);

function withoutClock(request: unknown): unknown {
  if (typeof request !== 'object' || request === null) return request;
  const { nowMs: _nowMs, ...rest } = request as Record<string, unknown>;
  return rest;
}

/** Every engine method call, in order. */
export type EngineCallLog = {
  calls: EngineCall[];
  /** Calls by method name since `mark` was taken. */
  countsSince(mark: number): Record<string, number>;
  /** Records engine calls since `mark` returned, once they settled. */
  recordsOutSince(mark: number): number;
  /** View reads since `mark` (`VIEW_READS`). */
  viewReadsSince(mark: number): ViewReads;
  /** Every call that threw or rejected, as `method: reason`. */
  errors(): string[];
  mark(): number;
};

function createEngineCallLog(): EngineCallLog {
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
    recordsOutSince: (mark) =>
      calls
        .slice(mark)
        .reduce((total, call) => total + (call.recordsOut ?? 0), 0),
    errors: () =>
      calls.flatMap((call) =>
        call.error === undefined ? [] : [`${call.method}: ${call.error}`]
      ),
    viewReadsSince: (mark) => {
      const perView = new Map<string, number>();
      for (const { view } of calls.slice(mark))
        if (view !== undefined) perView.set(view, (perView.get(view) ?? 0) + 1);
      let repeats = 0;
      let maxPerView = 0;
      for (const count of perView.values()) {
        repeats += count - 1;
        maxPerView = Math.max(maxPerView, count);
      }
      return { views: perView.size, repeats, maxPerView };
    },
  };
}

/** Records a result carries: live-query upserts and patches, records read by
 * key, and query reads (one). Window keys are not records. */
function countRecords(result: unknown): number {
  if (typeof result !== 'object' || result === null) return 0;
  const value = result as Record<string, unknown>;
  let records = 0;
  for (const field of ['upserts', 'patches', 'records'] as const) {
    const list = value[field];
    if (Array.isArray(list)) records += list.length;
  }
  if (value.kind === 'hit' && 'data' in value) records += 1;
  return records;
}

/** Marks `call` settled with nothing returned, so a step waiting for open
 * calls does not wait on it, and keeps why. */
function recordFailure(call: EngineCall, error: unknown): void {
  call.recordsOut = 0;
  call.error = error instanceof Error ? error.message : String(error);
}

async function settleCounted(
  call: EngineCall,
  pending: Promise<unknown>
): Promise<unknown> {
  try {
    const settled = await pending;
    call.recordsOut = countRecords(settled);
    return settled;
  } catch (error) {
    recordFailure(call, error);
    throw error;
  }
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
        const viewOf = VIEW_READS.get(property);
        const call: EngineCall = viewOf
          ? {
              method: property,
              view: `${property} ${JSON.stringify(viewOf(args))}`,
            }
          : { method: property };
        log.calls.push(call);
        let result: unknown;
        try {
          result = Reflect.apply(value, target, args);
        } catch (error) {
          recordFailure(call, error);
          throw error;
        }
        if (result instanceof Promise) return settleCounted(call, result);
        call.recordsOut = countRecords(result);
        return result;
      };
    },
  });
}

const COMPILED = Symbol.for('macro.headless-cache.compiled');

type CompiledSlot = { [COMPILED]?: Promise<WebAssembly.Module> };

/** The engine binary, or why there is none to run. */
async function readEngineBinary() {
  try {
    return await readFile(WASM_BINARY);
  } catch (error) {
    throw new Error(
      `the cache engine is not built (${WASM_BINARY}); run \`just build-cache-wasm\` in apps/web`,
      { cause: error }
    );
  }
}

// Compiled once per process, as the page hands one compile to every engine
// worker (`worker/compiled-engine.ts`).
function compileEngine(): Promise<WebAssembly.Module> {
  const slots = globalThis as CompiledSlot;
  slots[COMPILED] ??= (async () => {
    return await WebAssembly.compile(await readEngineBinary());
  })();
  return slots[COMPILED];
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

const CURRENT_ENGINE = Symbol.for('macro.headless-cache.engine');
const INSTANCES = Symbol.for('macro.headless-cache.instances');

// On `globalThis`: the engine worker's mock (`setup.ts`) and the runtime that
// loaded the engine can sit in different module graphs.
type EngineSlots = {
  [CURRENT_ENGINE]?: RealCacheWasm;
  [INSTANCES]?: number;
};

/** The engine the current runtime's engine worker gets (`setup.ts`). */
export function currentRealCacheWasm(): RealCacheWasm {
  const engine = (globalThis as EngineSlots)[CURRENT_ENGINE];
  if (!engine)
    throw new Error(
      'No headless runtime is installed; start one with installHeadlessCacheRuntime'
    );
  return engine;
}

export function setCurrentRealCacheWasm(engine: RealCacheWasm | undefined) {
  (globalThis as EngineSlots)[CURRENT_ENGINE] = engine;
}

/**
 * A new instance of the engine, as a new engine worker loads one: its own
 * linear memory and counters, over the module compiled once per process. As in
 * `loadCacheWasm`, the linear memory must be exported and the slow-query
 * callback is installed. Every open hands out a recorded engine.
 */
export async function loadRealCacheWasm(): Promise<RealCacheWasm> {
  const slots = globalThis as EngineSlots;
  const instance = (slots[INSTANCES] ?? 0) + 1;
  slots[INSTANCES] = instance;
  // The glue holds its instance in module state; a distinct URL is a
  // distinct module.
  const glue = (await import(
    /* @vite-ignore */ `${pathToFileURL(WASM_JS).href}?instance=${instance}`
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
