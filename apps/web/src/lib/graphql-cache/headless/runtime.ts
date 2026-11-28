/**
 * The production cache chain in one test process: the page host
 * (`createWorkerCacheHost`), the SharedWorker coordinator, and the dedicated
 * engine worker running `CacheWorkerCore` over the real cache-wasm engine,
 * with OPFS and Web Locks held in memory. Workers are linked message ports in
 * the same event loop, so every message crosses the same validation and
 * dispatch it does in a browser, without the thread hop.
 *
 * Each runtime loads its own engine instance, as a new engine worker does; the
 * test config must mock `loadCacheWasm` to hand it out (`./setup.ts` does).
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
import {
  createMemoryOpfs,
  type MemoryOpfs,
  reopenMemoryOpfs,
} from './memory-opfs';
import {
  loadRealCacheWasm,
  type RealCacheWasm,
  setCurrentRealCacheWasm,
} from './real-engine';

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
 * How long `dispose` waits for the engine workers to finish their departure:
 * the host's request timeout, the longest an admitted read can hold it.
 */
const DEPARTURE_TIMEOUT_MS = REQUEST_TIMEOUT_MS;

/** Resolves once every worker in `exits` has ended, or fails after `ms`. */
async function awaitWorkerExits(
  exits: readonly Promise<void>[],
  ms: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `An engine worker did not drain or terminate within ${ms} ms of dispose`
          )
        ),
      ms
    );
  });
  try {
    await Promise.race([Promise.all(exits), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Every channel the page and workers open, so `dispose` can close them. */
function trackedMessageChannel(
  opened: LinkedMessageChannel[]
): typeof LinkedMessageChannel {
  return class extends LinkedMessageChannel {
    constructor() {
      super();
      opened.push(this);
    }
  };
}

/**
 * Installs the worker, OPFS and lock globals and loads the engine. One runtime
 * at a time: the globals are stubbed with `vi.stubGlobal` and restored on
 * `dispose`. Pass `reopen`, the `opfs` of a disposed runtime, to load the next
 * page over its files (`reopenMemoryOpfs`).
 */
export async function installHeadlessCacheRuntime(
  options: { reopen?: MemoryOpfs } = {}
): Promise<HeadlessCacheRuntime> {
  const engine = await loadRealCacheWasm();
  setCurrentRealCacheWasm(engine);
  const opfs = options.reopen
    ? reopenMemoryOpfs(options.reopen)
    : createMemoryOpfs();
  for (const [name, value] of Object.entries(opfs.globals))
    vi.stubGlobal(name, value);

  // The page's tab lock is held by this same process for the test's life.
  const router = new CoordinatorRouter({
    verifyTabLockHeld: async () => true,
    watchTabLock: () => () => undefined,
  });
  const channels: LinkedMessageChannel[] = [];
  const TrackedMessageChannel = trackedMessageChannel(channels);
  // One per engine worker: settles when it closes itself after draining, or
  // when the page terminates it.
  const workerExits: Promise<void>[] = [];
  vi.stubGlobal('MessageChannel', TrackedMessageChannel);
  vi.stubGlobal(
    'SharedWorker',
    class {
      onerror: ((event: ErrorEvent) => unknown) | null = null;
      readonly port: LinkedMessagePort;

      constructor() {
        const channel = new TrackedMessageChannel();
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
      private exited: () => void = () => {};
      private readonly scope = {
        onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
        close: () => this.exited(),
      };

      constructor() {
        workerExits.push(
          new Promise<void>((resolve) => {
            this.exited = resolve;
          })
        );
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

      terminate(): void {
        this.exited();
      }
    }
  );

  const observations: CacheTelemetryObservation[] = [];
  const initializationErrors: Error[] = [];
  const hosts: CacheHost[] = [];
  const dispose = async (): Promise<void> => {
    try {
      for (const host of hosts.splice(0)) await host.dispose();
      // A host's dispose starts its departure and returns. Its engine worker
      // still answers what the host admitted, then drains (flushing its
      // files) and closes, so wait for that; the next runtime reopens those
      // files. The coordinator keeps posting to the page's ports for a while
      // after, and closed ports drop those messages, so none reaches a port
      // after the test's environment is gone.
      await awaitWorkerExits(workerExits.splice(0), DEPARTURE_TIMEOUT_MS);
    } finally {
      // Also after a worker that never drained, so the next test starts
      // without this runtime's ports and globals.
      for (const channel of channels.splice(0)) {
        channel.port1.close();
        channel.port2.close();
      }
      setCurrentRealCacheWasm(undefined);
      vi.unstubAllGlobals();
    }
  };
  // Every caller waits for the same teardown: a second call must not find
  // the lists already taken and close the ports while a worker drains.
  let disposed: Promise<void> | undefined;
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
    dispose() {
      disposed ??= dispose();
      return disposed;
    },
  };
}
