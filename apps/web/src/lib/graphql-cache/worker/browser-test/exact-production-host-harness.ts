import { createWorkerCacheHost } from '../../host/worker-host';

const resultElement = document.querySelector<HTMLElement>('#result');
if (!resultElement) throw new Error('missing result element');

const NativeWorker = globalThis.Worker;
const NativeSharedWorker = globalThis.SharedWorker;
let sharedWorkerConstructions = 0;
let dedicatedWorkerConstructions = 0;
let engineWorkerUrl = '';
globalThis.SharedWorker = new Proxy(NativeSharedWorker, {
  construct(target, argumentsList) {
    sharedWorkerConstructions++;
    return Reflect.construct(target, argumentsList);
  },
});
globalThis.Worker = new Proxy(NativeWorker, {
  construct(target, argumentsList) {
    const [url, options] = argumentsList as ConstructorParameters<
      typeof Worker
    >;
    if (options?.name?.startsWith('graphql-cache-engine:')) {
      dedicatedWorkerConstructions++;
      engineWorkerUrl = String(url);
    }
    return Reflect.construct(target, argumentsList);
  },
});

const scope = `cache-exact-production-${crypto.randomUUID()}`;
const host = createWorkerCacheHost({
  scope,
  requestTimeoutMs: 15_000,
  initializationTimeoutMs: 15_000,
});

try {
  await host.readQuery({
    opKey: 1,
    query: `query CacheExactProduction($input: SoupInput!) {
      user {
        id
        soup(input: $input) {
          nextCursor
          items { __typename id }
        }
      }
    }`,
    operationName: 'CacheExactProduction',
    variables: { input: { limit: 1 } },
  });
  resultElement.textContent = JSON.stringify({
    sharedWorkerConstructions,
    dedicatedWorkerConstructions,
    engineWorkerUrl,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    sharedArrayBufferAvailable:
      typeof globalThis.SharedArrayBuffer === 'function',
  });
  resultElement.dataset.status = 'passed';
} catch (error) {
  resultElement.textContent =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  resultElement.dataset.status = 'failed';
} finally {
  host.dispose();
}
