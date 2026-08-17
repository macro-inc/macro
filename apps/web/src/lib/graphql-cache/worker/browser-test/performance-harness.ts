import { createWorkerCacheHost } from '../../host/worker-host';
import instrumentedEngineWorkerUrl from './instrumented-cache.engine-worker.ts?worker&url';

const resultElement = document.querySelector<HTMLElement>('#result');
if (!resultElement) throw new Error('missing result element');

declare const __CACHE_WASM_BUILD_MODE__: 'development' | 'production';

type WorkerObservation = {
  kind: 'shared' | 'dedicated';
  requestedUrl: string;
  actualUrl: string;
};
let workerObserver: ((observation: WorkerObservation) => void) | undefined;
let workerErrorObserver: ((error: Error) => void) | undefined;
const NativeWorker = globalThis.Worker;
const NativeSharedWorker = globalThis.SharedWorker;
globalThis.Worker = new Proxy(NativeWorker, {
  construct(target, argumentsList) {
    const [requestedUrl, options] = argumentsList as ConstructorParameters<
      typeof Worker
    >;
    const isCacheEngine = options?.name?.startsWith('graphql-cache-engine:');
    const actualUrl = isCacheEngine
      ? instrumentedEngineWorkerUrl
      : requestedUrl;
    workerObserver?.({
      kind: 'dedicated',
      requestedUrl: String(requestedUrl),
      actualUrl: new URL(String(actualUrl), location.href).href,
    });
    const worker = Reflect.construct(target, [actualUrl, options]);
    worker.addEventListener('error', (event: ErrorEvent) => {
      workerErrorObserver?.(
        new Error(event.message || 'instrumented engine worker failed')
      );
    });
    worker.addEventListener('messageerror', () => {
      workerErrorObserver?.(
        new Error('instrumented engine worker emitted messageerror')
      );
    });
    return worker;
  },
});
globalThis.SharedWorker = new Proxy(NativeSharedWorker, {
  construct(target, argumentsList) {
    workerObserver?.({
      kind: 'shared',
      requestedUrl: String(argumentsList[0]),
      actualUrl: String(argumentsList[0]),
    });
    return Reflect.construct(target, argumentsList);
  },
});

type WorkerTelemetry =
  | { kind: 'activation-started'; ownerEpoch: number }
  | {
      kind: 'database-ready';
      ownerEpoch: number;
      workerActivationMs: number;
      linearMemoryBytes: number;
      wasmFetchCount: number;
      wasmSha256: string;
      nestedWorkerConstructions: number;
      crossOriginIsolated: boolean;
      sharedArrayBufferAvailable: boolean;
    };

export interface CacheWasmPerformanceSample {
  mode: 'development' | 'production';
  activationMs: number;
  browserReadyMs: number;
  hostFirstReadyMs: number;
  workerActivationMs: number;
  linearMemoryBytes: number;
  sharedWorkerConstructions: number;
  dedicatedWorkerConstructions: number;
  nestedWorkerConstructions: number;
  wasmFetchCount: number;
  wasmSha256: string;
  ownerEpochs: number[];
  crossOriginIsolated: boolean;
  sharedArrayBufferAvailable: boolean;
  sharedWorkerUrl: string;
  productionEngineUrl: string;
  instrumentedEngineUrl: string;
}

const waitFor = <T>(
  description: string,
  install: (resolve: (value: T) => void, reject: (error: Error) => void) => void
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${description} timed out`)),
      15_000
    );
    install(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const QUERY = `query CachePerformance($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      nextCursor
      items {
        __typename
        id
      }
    }
  }
}`;

async function runMeasurement(): Promise<CacheWasmPerformanceSample> {
  const scope = `cache-performance-${crypto.randomUUID()}`;
  const started = performance.now();
  let activationMs = 0;
  let sharedWorkerConstructions = 0;
  let dedicatedWorkerConstructions = 0;
  let sharedWorkerUrl = '';
  let productionEngineUrl = '';
  let actualInstrumentedEngineUrl = '';
  const ownerEpochs = new Set<number>();
  workerObserver = ({ kind, requestedUrl, actualUrl }) => {
    if (kind === 'shared') {
      sharedWorkerConstructions++;
      sharedWorkerUrl = requestedUrl;
    } else {
      dedicatedWorkerConstructions++;
      productionEngineUrl = requestedUrl;
      actualInstrumentedEngineUrl = actualUrl;
    }
  };
  const telemetryChannel = new BroadcastChannel(
    `graphql-cache-performance:${scope}`
  );
  let rejectDatabaseReady: ((error: Error) => void) | undefined;
  const databaseReady = waitFor<
    Extract<WorkerTelemetry, { kind: 'database-ready' }> & {
      browserReadyMs: number;
    }
  >('cache database ready', (resolve, reject) => {
    rejectDatabaseReady = reject;
    telemetryChannel.onmessage = (event: MessageEvent<WorkerTelemetry>) => {
      ownerEpochs.add(event.data.ownerEpoch);
      if (event.data.kind === 'activation-started') {
        activationMs = performance.now() - started;
        return;
      }
      resolve({
        ...event.data,
        browserReadyMs: performance.now() - started,
      });
    };
  });
  workerErrorObserver = (error) => rejectDatabaseReady?.(error);
  const host = createWorkerCacheHost({
    scope,
    requestTimeoutMs: 15_000,
    initializationTimeoutMs: 15_000,
    onInitializationError: (error) => rejectDatabaseReady?.(error),
  });
  const firstReady = host.readQuery({
    opKey: 1,
    query: QUERY,
    operationName: 'CachePerformance',
    variables: { input: { limit: 1 } },
  });
  const [ready] = await Promise.all([databaseReady, firstReady]);
  const hostFirstReadyMs = performance.now() - started;
  host.dispose();
  telemetryChannel.close();
  workerObserver = undefined;
  workerErrorObserver = undefined;
  return {
    mode: __CACHE_WASM_BUILD_MODE__,
    activationMs,
    browserReadyMs: ready.browserReadyMs,
    hostFirstReadyMs,
    workerActivationMs: ready.workerActivationMs,
    linearMemoryBytes: ready.linearMemoryBytes,
    sharedWorkerConstructions,
    dedicatedWorkerConstructions,
    nestedWorkerConstructions: ready.nestedWorkerConstructions,
    wasmFetchCount: ready.wasmFetchCount,
    wasmSha256: ready.wasmSha256,
    ownerEpochs: [...ownerEpochs].sort((left, right) => left - right),
    crossOriginIsolated: ready.crossOriginIsolated,
    sharedArrayBufferAvailable: ready.sharedArrayBufferAvailable,
    sharedWorkerUrl,
    productionEngineUrl,
    instrumentedEngineUrl: actualInstrumentedEngineUrl,
  };
}

Object.assign(window, { runCacheWasmPerformanceSample: runMeasurement });
resultElement.dataset.status = 'idle';
resultElement.textContent = JSON.stringify({ mode: __CACHE_WASM_BUILD_MODE__ });
