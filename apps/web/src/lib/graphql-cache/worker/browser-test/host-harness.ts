import { createWorkerCacheHost } from '../../host/worker-host';
import productionCacheWorkerUrl from './production-cache.engine-worker.ts?worker&url';

const resultNode = document.querySelector('#result');
if (!(resultNode instanceof HTMLElement))
  throw new Error('missing result node');

const scope = `wp09-host-${crypto.randomUUID()}`;
const telemetry = new BroadcastChannel(
  `graphql-cache-wp08-production:${scope}`
);
type TelemetryEvent = {
  kind: string;
  ownerEpoch: number;
  requestId?: number;
  requestKind?: string;
  slow?: boolean;
};
const telemetryEvents: TelemetryEvent[] = [];
telemetry.onmessage = (event: MessageEvent<TelemetryEvent>) => {
  telemetryEvents.push(event.data);
};

const waitUntil = async (
  label: string,
  predicate: () => boolean,
  timeoutMs = 20_000
): Promise<void> => {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`${label} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const nativeWorker = globalThis.Worker;
const nativeSharedWorker = globalThis.SharedWorker;
const engineWorkers: Worker[] = [];
const terminatedEpochs: number[] = [];
let sharedWorkerConstructions = 0;
let sharedPortClosed = false;

const workerProxy = new Proxy(nativeWorker, {
  construct(_target, args: ConstructorParameters<typeof Worker>) {
    const [url, options] = args;
    const epoch = Number(options?.name?.split(':').at(-1));
    const worker = options?.name?.startsWith('graphql-cache-engine:')
      ? new nativeWorker(productionCacheWorkerUrl, options)
      : new nativeWorker(url, options);
    if (options?.name?.startsWith('graphql-cache-engine:')) {
      engineWorkers.push(worker);
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        terminatedEpochs.push(epoch);
        terminate();
      };
    }
    return worker;
  },
});
globalThis.Worker = workerProxy;

const sharedWorkerProxy = new Proxy(nativeSharedWorker, {
  construct(_target, args: ConstructorParameters<typeof SharedWorker>) {
    sharedWorkerConstructions += 1;
    const worker = new nativeSharedWorker(...args);
    const close = worker.port.close.bind(worker.port);
    worker.port.close = () => {
      sharedPortClosed = true;
      close();
    };
    return worker;
  },
});
globalThis.SharedWorker = sharedWorkerProxy;

const QUERY = `query Soup($input: SoupInput!) {
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
const SLOW_QUERY = QUERY.replace('query Soup', 'query Slow');
const VARIABLES = { input: { limit: 1 } };

const report: Record<string, unknown> = {
  passed: false,
  noEagerConstructor: false,
  requestOrder: [],
  oldEpochRejectedBeforeReplacement: false,
  oldRequestReplayCount: 0,
  replacementActiveKeys: [],
  replacementReadCompleted: false,
  gracefulDrained: false,
  terminatedEpochs,
  sharedPortClosed: false,
  initializationErrors: [],
};

try {
  const initializationErrors: string[] = [];
  const host = createWorkerCacheHost({
    scope,
    requestTimeoutMs: 10_000,
    onInitializationError: (error) => initializationErrors.push(error.message),
  });
  report.noEagerConstructor =
    sharedWorkerConstructions === 0 && engineWorkers.length === 0;

  const order: string[] = [];
  const replacementActiveKeys: number[][] = [];
  let replacementRead: Promise<unknown> | undefined;
  host.onOpsAffected((keys) => {
    order.push('active-notified');
    replacementActiveKeys.push(keys);
    replacementRead ??= host.readQuery({
      opKey: keys[0],
      query: QUERY,
      operationName: 'Soup',
      variables: VARIABLES,
    });
  });

  await Promise.all([
    host.readQuery({
      opKey: 7,
      query: QUERY,
      operationName: 'Soup',
      variables: VARIABLES,
    }),
    host.readQuery({
      opKey: 9,
      query: QUERY,
      operationName: 'Soup',
      variables: VARIABLES,
    }),
  ]);
  const slowRead = host.readQuery({
    opKey: 7,
    query: SLOW_QUERY,
    operationName: 'Slow',
    variables: VARIABLES,
  });
  const slowOutcome = slowRead.then(
    () => undefined,
    (error: unknown) => {
      order.push('old-request-rejected');
      return error;
    }
  );
  await waitUntil('slow request admission', () =>
    telemetryEvents.some((event) => event.slow === true)
  );

  engineWorkers[0]?.postMessage({ testKind: 'crash' });
  const oldError = (await slowOutcome) as
    | (Error & { errorCode?: string })
    | undefined;
  await waitUntil('replacement active notification', () =>
    order.includes('active-notified')
  );
  await waitUntil('replacement read creation', () => replacementRead != null);
  await replacementRead;

  const routedRequests = telemetryEvents.filter(
    (event) => event.kind === 'request-admitted'
  );
  report.requestOrder = routedRequests.map((event) => [
    event.ownerEpoch,
    event.requestId,
    event.requestKind,
  ]);
  report.oldEpochRejectedBeforeReplacement =
    oldError?.errorCode === 'owner-epoch-lost' &&
    order.join(',') === 'old-request-rejected,active-notified';
  report.oldRequestReplayCount = routedRequests.filter(
    (event) => event.slow === true
  ).length;
  report.replacementActiveKeys = replacementActiveKeys;
  report.replacementReadCompleted = routedRequests.some(
    (event) =>
      event.ownerEpoch === 2 &&
      event.requestKind === 'read' &&
      event.slow === false
  );

  host.dispose();
  await waitUntil('graceful engine drain', () =>
    telemetryEvents.some(
      (event) => event.kind === 'drained' && event.ownerEpoch === 2
    )
  );
  await waitUntil('graceful worker termination', () =>
    terminatedEpochs.includes(2)
  );
  await waitUntil('coordinator port close', () => sharedPortClosed);

  report.gracefulDrained = true;
  report.sharedPortClosed = sharedPortClosed;
  report.initializationErrors = initializationErrors;
  report.passed =
    report.noEagerConstructor === true &&
    report.oldEpochRejectedBeforeReplacement === true &&
    report.oldRequestReplayCount === 1 &&
    JSON.stringify(replacementActiveKeys) === JSON.stringify([[7, 9]]) &&
    report.replacementReadCompleted === true &&
    report.gracefulDrained === true &&
    sharedPortClosed &&
    JSON.stringify(terminatedEpochs) === JSON.stringify([1, 2]) &&
    initializationErrors.length === 0;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
}

resultNode.dataset.status = report.passed ? 'passed' : 'failed';
resultNode.textContent = JSON.stringify(report);
telemetry.close();
