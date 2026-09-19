import { match } from 'ts-pattern';
import type { CacheRequest, CacheResponse } from '../../protocol';
import {
  createCacheCoordinatorPageAdapter,
  type DedicatedWorkerLike,
} from '../coordinator-page-adapter';
import type {
  BrowserHarnessCommand,
  BrowserHarnessEnvelope,
} from './browser-wire';

const parameters = new URLSearchParams(location.search);
const tabId = parameters.get('tabId') ?? '';
const scope = parameters.get('scope') ?? '';
if (!tabId || !scope) throw new Error('missing browser harness parameters');

const channel = new BroadcastChannel(`graphql-cache-wp08-tabs:${scope}`);
const report = (
  event: Extract<BrowserHarnessEnvelope, { source: 'tab' }>['event']
): void => {
  channel.postMessage({
    source: 'tab',
    tabId,
    event,
  } satisfies BrowserHarnessEnvelope);
};

let releaseLivenessLock!: () => void;
const releaseLivenessSignal = new Promise<void>((resolve) => {
  releaseLivenessLock = resolve;
});
const lockManager = {
  request: ((
    lockName: string,
    options: LockOptions,
    callback: (lock: Lock | null) => unknown
  ) =>
    navigator.locks.request(lockName, options, async (lock) => {
      // The harness intentionally releases liveness early and discards a
      // callback result that no caller consumes.
      await Promise.race([
        Promise.resolve(callback(lock)),
        releaseLivenessSignal,
      ]);
    })) as LockManager['request'],
};

let nextRequestId = 1;
let currentWorker: DedicatedWorkerLike | undefined;
const pending = new Map<
  number,
  { commandId: string; resolve: (response: CacheResponse) => void }
>();

const adapter = createCacheCoordinatorPageAdapter({
  scope,
  tabId,
  createSharedWorker: (workerScope) =>
    new SharedWorker(
      new URL('./fake-coordinator.shared-worker.ts', import.meta.url),
      {
        type: 'module',
        name: `graphql-cache-wp08-coordinator:${workerScope}`,
      }
    ),
  lockManager,
  createDedicatedWorker: (_scope, ownerEpoch) =>
    new Worker(new URL('./fake-cache.engine-worker.ts', import.meta.url), {
      type: 'module',
      name: `graphql-cache-wp08-fake:${scope}:${ownerEpoch}`,
    }),
  onWorkerCreated: (worker, ownerEpoch) => {
    currentWorker = worker;
    report({ kind: 'worker-created', ownerEpoch });
  },
  onWorkerTerminated: (ownerEpoch, reason) => {
    currentWorker = undefined;
    report({ kind: 'worker-terminated', ownerEpoch, reason });
  },
  onEngineReplaced: (ownerEpoch) => {
    report({ kind: 'engine-replaced', ownerEpoch });
  },
  onProtocolError: (error) => {
    report({ kind: 'protocol-error', error: error.message });
  },
});
report({ kind: 'adapter-created' });

adapter.onmessage = (event) => {
  const message = event.data;
  if ('kind' in message) {
    report({ kind: 'cache-push', pushKind: message.kind });
    return;
  }
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  waiter.resolve(message);
};

type CacheRequestWithoutId = CacheRequest extends infer Request
  ? Request extends CacheRequest
    ? Omit<Request, 'id'>
    : never
  : never;

const sendRequest = async (
  commandId: string,
  request: CacheRequestWithoutId
): Promise<void> => {
  const id = nextRequestId++;
  const response = new Promise<CacheResponse>((resolve) => {
    pending.set(id, { commandId, resolve });
  });
  adapter.postMessage({ ...request, id } as CacheRequest);
  const result = await response;
  if (result.ok) {
    report({
      kind: 'command-result',
      commandId,
      ok: true,
      result: result.result,
    });
  } else {
    report({
      kind: 'command-result',
      commandId,
      ok: false,
      error: result.error,
    });
  }
};

const handleCommand = (command: BrowserHarnessCommand): void => {
  match(command)
    .with({ kind: 'write' }, (value) => {
      void sendRequest(value.commandId, {
        kind: 'write',
        query: 'query Value { value }',
        data: { value: value.value },
      });
    })
    .with({ kind: 'read' }, (value) => {
      void sendRequest(value.commandId, {
        kind: 'read',
        query: 'query Value { value }',
      });
    })
    .with({ kind: 'slow-read' }, (value) => {
      void sendRequest(value.commandId, {
        kind: 'read',
        query: 'query Slow { value }',
      });
    })
    .with({ kind: 'graceful-close' }, (value) => {
      void adapter.dispose({ graceful: true }).then(() => {
        report({
          kind: 'command-result',
          commandId: value.commandId,
          ok: true,
        });
        setTimeout(() => window.close());
      });
    })
    .with({ kind: 'crash-worker' }, (value) => {
      if (!currentWorker) {
        report({
          kind: 'command-result',
          commandId: value.commandId,
          ok: false,
          error: 'tab has no worker',
        });
        return;
      }
      currentWorker.postMessage({ testKind: 'crash' }, []);
      report({ kind: 'command-result', commandId: value.commandId, ok: true });
    })
    .with({ kind: 'release-liveness-lock' }, (value) => {
      releaseLivenessLock();
      report({ kind: 'command-result', commandId: value.commandId, ok: true });
    })
    .with({ kind: 'stale-response' }, (value) => {
      if (!currentWorker) {
        report({
          kind: 'command-result',
          commandId: value.commandId,
          ok: false,
          error: 'tab has no worker',
        });
        return;
      }
      currentWorker.postMessage(
        {
          testKind: 'stale-response',
          ownerEpoch: value.ownerEpoch,
          routeId: value.routeId,
        },
        []
      );
      report({ kind: 'command-result', commandId: value.commandId, ok: true });
    })
    .exhaustive();
};

channel.onmessage = (event: MessageEvent<BrowserHarnessEnvelope>) => {
  const message = event.data;
  if (message.source === 'harness' && message.targetTabId === tabId) {
    handleCommand(message.command);
  }
};

// First cache use starts liveness registration. Every page deliberately uses
// request id 1, proving the coordinator must rewrite ids before engine routing.
adapter.postMessage({ id: nextRequestId++, kind: 'init', scope });
void adapter.start().then(() => report({ kind: 'registered' }));
