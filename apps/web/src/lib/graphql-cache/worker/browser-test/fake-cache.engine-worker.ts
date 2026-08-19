/// <reference lib="webworker" />

import type { CacheRequest, CacheResponse } from '../../protocol';
import {
  CACHE_COORDINATOR_PROTOCOL_VERSION,
  type CoordinatorToEngineEnvelope,
  type EngineToCoordinatorEnvelope,
  type PageToEngineEnvelope,
  validateCoordinatorToEngineEnvelope,
  validatePageToEngineEnvelope,
} from '../coordinator-protocol';

declare const self: DedicatedWorkerGlobalScope;

const withVersion = <T extends { coordinatorVersion: 2 }>(
  value: T extends unknown ? Omit<T, 'coordinatorVersion'> : never
): T =>
  ({
    coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
    ...value,
  }) as unknown as T;

const databaseName = (scope: string): string =>
  `graphql-cache-wp08-browser:${scope}`;

const openDatabase = async (scope: string): Promise<IDBDatabase> =>
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName(scope), 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('records')) {
        request.result.createObjectStore('records');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('open failed'));
  });

const deleteDatabase = async (scope: string): Promise<void> =>
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName(scope));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('delete failed'));
    request.onblocked = () => reject(new Error('delete blocked'));
  });

const put = async (database: IDBDatabase, value: unknown): Promise<void> =>
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('records', 'readwrite');
    transaction.objectStore('records').put(value, 'root');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('put failed'));
  });

const get = async (database: IDBDatabase): Promise<unknown | undefined> =>
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('records', 'readonly');
    const request = transaction.objectStore('records').get('root');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('get failed'));
  });

const clear = async (database: IDBDatabase): Promise<void> =>
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('records', 'readwrite');
    transaction.objectStore('records').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('clear failed'));
  });

const delay = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds));

let controlPort: MessagePort | undefined;
let activationValue: PageToEngineEnvelope | undefined;
let telemetry: BroadcastChannel | undefined;
let ignoreHeartbeats = false;

const sendStaleResponse = (ownerEpoch: number, routeId: number): void => {
  controlPort?.postMessage(
    withVersion<EngineToCoordinatorEnvelope>({
      kind: 'engine-response',
      ownerEpoch,
      routeId,
      response: { id: routeId, ok: true, result: 'stale-must-not-escape' },
    })
  );
};

const execute = async (
  database: IDBDatabase,
  request: CacheRequest
): Promise<CacheResponse> => {
  if (request.kind === 'read' && request.query.includes('Slow')) {
    await delay(10_000);
  }
  switch (request.kind) {
    case 'init':
      return { id: request.id, ok: true, result: null };
    case 'write':
      await put(database, request.data);
      return {
        id: request.id,
        ok: true,
        result: { changed: ['ROOT_QUERY'], affectedOps: [], reset: false },
      };
    case 'read': {
      const value = await get(database);
      return {
        id: request.id,
        ok: true,
        result:
          value === undefined ? { kind: 'miss' } : { kind: 'hit', data: value },
      };
    }
    case 'clear':
      await clear(database);
      return { id: request.id, ok: true, result: null };
    default:
      return {
        id: request.id,
        ok: false,
        error: `fake engine does not implement ${request.kind}`,
      };
  }
};

async function activate(
  activation: PageToEngineEnvelope,
  port: MessagePort
): Promise<void> {
  activationValue = activation;
  controlPort = port;
  telemetry = new BroadcastChannel(`graphql-cache-wp08:${activation.scope}`);
  await navigator.locks.request(
    activation.ownerLockName,
    { mode: 'exclusive' },
    async (lock) => {
      if (!lock) throw new Error('owner lock was not acquired');
      telemetry?.postMessage({
        kind: 'lock-acquired',
        tabId: activation.tabId,
        ownerEpoch: activation.ownerEpoch,
      });
      let database: IDBDatabase | undefined;
      let queue = Promise.resolve();
      let draining = false;
      let requestShutdown: (() => void) | undefined;
      const shutdown = new Promise<void>((resolve) => {
        requestShutdown = resolve;
      });
      try {
        if (activation.databaseAction === 'wipe-before-open') {
          telemetry?.postMessage({
            kind: 'wipe-started',
            ownerEpoch: activation.ownerEpoch,
          });
          await deleteDatabase(activation.scope);
          telemetry?.postMessage({
            kind: 'wipe-completed',
            ownerEpoch: activation.ownerEpoch,
          });
        }
        database = await openDatabase(activation.scope);
        const activeDatabase = database;
        port.onmessage = (event: MessageEvent<unknown>) => {
          const parsed = validateCoordinatorToEngineEnvelope(event.data);
          if (!parsed.ok) return;
          const message: CoordinatorToEngineEnvelope = parsed.value;
          if (message.ownerEpoch !== activation.ownerEpoch) return;
          switch (message.kind) {
            case 'heartbeat':
              if (!ignoreHeartbeats) {
                port.postMessage(
                  withVersion<EngineToCoordinatorEnvelope>({
                    kind: 'heartbeat-ack',
                    ownerEpoch: activation.ownerEpoch,
                    heartbeatId: message.heartbeatId,
                  })
                );
              }
              break;
            case 'drain-engine':
              if (draining) return;
              draining = true;
              void queue.finally(() => requestShutdown?.());
              break;
            case 'engine-request':
              if (draining) return;
              telemetry?.postMessage({
                kind: 'request-started',
                tabId: activation.tabId,
                ownerEpoch: activation.ownerEpoch,
                routeId: message.routeId,
                requestKind: message.request.kind,
                requestId: message.request.id,
                slow:
                  message.request.kind === 'read' &&
                  message.request.query.includes('Slow'),
              });
              queue = queue.then(async () => {
                let response: CacheResponse;
                try {
                  response = await execute(activeDatabase, message.request);
                } catch (error) {
                  response = {
                    id: message.request.id,
                    ok: false,
                    error:
                      error instanceof Error ? error.message : String(error),
                  };
                }
                port.postMessage(
                  withVersion<EngineToCoordinatorEnvelope>({
                    kind: 'engine-response',
                    ownerEpoch: activation.ownerEpoch,
                    routeId: message.routeId,
                    response,
                  })
                );
                if (
                  response.ok &&
                  (message.request.kind === 'write' ||
                    message.request.kind === 'clear')
                ) {
                  port.postMessage(
                    withVersion<EngineToCoordinatorEnvelope>({
                      kind: 'engine-push',
                      ownerEpoch: activation.ownerEpoch,
                      push: { kind: 'cache-changed' },
                    })
                  );
                }
              });
              break;
          }
        };
        port.start();
        port.postMessage(
          withVersion<EngineToCoordinatorEnvelope>({
            kind: 'engine-ready',
            tabId: activation.tabId,
            ownerEpoch: activation.ownerEpoch,
            ownerLockName: activation.ownerLockName,
            ownerLockHeld: true,
            databaseActionProof:
              activation.databaseAction === 'wipe-before-open'
                ? 'wiped-before-open'
                : 'opened-existing',
            openOutcome:
              activation.databaseAction === 'wipe-before-open'
                ? 'reset-storage-uncertain'
                : 'opened-existing',
          })
        );
        telemetry?.postMessage({
          kind: 'ready',
          tabId: activation.tabId,
          ownerEpoch: activation.ownerEpoch,
        });

        await shutdown;
        await queue;
        database.close();
        database = undefined;
        port.postMessage(
          withVersion<EngineToCoordinatorEnvelope>({
            kind: 'engine-drained',
            tabId: activation.tabId,
            ownerEpoch: activation.ownerEpoch,
          })
        );
      } finally {
        database?.close();
        telemetry?.postMessage({
          kind: 'lock-releasing',
          tabId: activation.tabId,
          ownerEpoch: activation.ownerEpoch,
        });
      }
    }
  );
  port.close();
  telemetry?.close();
  self.close();
}

self.onmessage = (event: MessageEvent<unknown>) => {
  if (
    typeof event.data === 'object' &&
    event.data !== null &&
    'testKind' in event.data
  ) {
    const control = event.data as {
      testKind: string;
      ownerEpoch?: number;
      routeId?: number;
    };
    if (control.testKind === 'crash') {
      setTimeout(() => {
        throw new Error('harness-induced worker-only failure');
      });
    } else if (
      control.testKind === 'stale-response' &&
      control.ownerEpoch !== undefined &&
      control.routeId !== undefined
    ) {
      sendStaleResponse(control.ownerEpoch, control.routeId);
    } else if (control.testKind === 'hang-heartbeats') {
      ignoreHeartbeats = true;
    }
    return;
  }

  const parsed = validatePageToEngineEnvelope(event.data);
  const port = event.ports[0];
  if (!parsed.ok || !port || activationValue) {
    port?.close();
    return;
  }
  void activate(parsed.value, port);
};
