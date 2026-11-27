/**
 * The production cache chain in one test process: the page host
 * (`createWorkerCacheHost`), the SharedWorker coordinator, and the dedicated
 * engine worker running `CacheWorkerCore` over the real cache-wasm engine,
 * with OPFS and Web Locks held in memory. Workers are linked message ports in
 * the same event loop, so every message crosses the same validation and
 * dispatch it does in a browser, without the thread hop.
 *
 * The engine itself comes from `loadCacheWasm`, which the test config must mock
 * with `loadRealCacheWasm` (`./setup.ts` does).
 */
import { vi } from 'vitest';
import type { CacheHost } from '../host/types';
import { createWorkerCacheHost } from '../host/worker-host';
import {
  LinkedMessageChannel,
  type LinkedMessagePort,
} from '../host/worker-host.integration-helpers';
import type { CacheTelemetryObservation } from '../telemetry';
import { installCacheCoordinatorWorker } from '../worker/cache-coordinator-runtime';
import { installCacheEngineWorker } from '../worker/cache-engine-runtime';
import { CoordinatorRouter } from '../worker/coordinator-router';
import { CacheWorkerCore } from '../worker/worker-core';
import { createMemoryOpfs, type MemoryOpfs } from './memory-opfs';
import { loadRealCacheWasm, type RealCacheWasm } from './real-engine';

export type HeadlessCacheRuntime = {
  engine: RealCacheWasm;
  opfs: MemoryOpfs;
  /** Telemetry the page host recorded, in order. */
  observations: CacheTelemetryObservation[];
  /** Initialization failures any host reported; a healthy run has none. */
  initializationErrors: Error[];
  /** Opens the page host for `scope`; its first request starts the engine. */
  openHost(scope: string): CacheHost;
  /** Disposes every host this runtime opened and restores the globals. */
  dispose(): Promise<void>;
};

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Installs the worker, OPFS and lock globals and loads the engine. One runtime
 * per test: the globals are stubbed with `vi.stubGlobal` and restored on
 * `dispose`.
 */
export async function installHeadlessCacheRuntime(): Promise<HeadlessCacheRuntime> {
  const engine = await loadRealCacheWasm();
  const opfs = createMemoryOpfs();
  for (const [name, value] of Object.entries(opfs.globals))
    vi.stubGlobal(name, value);

  // The page's tab lock is held by this same process for the test's life.
  const router = new CoordinatorRouter({
    verifyTabLockHeld: async () => true,
    watchTabLock: () => () => undefined,
  });
  vi.stubGlobal('MessageChannel', LinkedMessageChannel);
  vi.stubGlobal(
    'SharedWorker',
    class {
      onerror: ((event: ErrorEvent) => unknown) | null = null;
      readonly port: LinkedMessagePort;

      constructor() {
        const channel = new LinkedMessageChannel();
        this.port = channel.port1;
        installCacheCoordinatorWorker({
          endpoint: channel.port2 as unknown as MessagePort,
          router,
        });
      }
    }
  );
  vi.stubGlobal(
    'Worker',
    class {
      onerror: ((event: ErrorEvent) => unknown) | null = null;
      onmessageerror: ((event: MessageEvent) => unknown) | null = null;
      private readonly scope = {
        onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
        close: () => {},
      };

      constructor() {
        installCacheEngineWorker({
          scope: this.scope,
          createCore: (options) => new CacheWorkerCore(options),
          readLinearMemoryBytes: engine.linearMemoryBytes,
        });
      }

      postMessage(message: unknown, transfer: Transferable[] = []): void {
        this.scope.onmessage?.({
          data: message,
          ports: transfer,
        } as unknown as MessageEvent);
      }

      terminate(): void {}
    }
  );

  const observations: CacheTelemetryObservation[] = [];
  const initializationErrors: Error[] = [];
  const hosts: CacheHost[] = [];
  return {
    engine,
    opfs,
    observations,
    initializationErrors,
    openHost(scope) {
      const host = createWorkerCacheHost({
        scope,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        initializationTimeoutMs: REQUEST_TIMEOUT_MS,
        onInitializationError: (error) => initializationErrors.push(error),
        telemetry: {
          record: (observation) => observations.push(observation),
          flush: () => {},
        },
      });
      hosts.push(host);
      return host;
    },
    async dispose() {
      for (const host of hosts.splice(0)) await host.dispose();
      vi.unstubAllGlobals();
    },
  };
}
