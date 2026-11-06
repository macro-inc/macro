import { match } from 'ts-pattern';
import type { CacheRequest, CacheResponse } from '../../protocol';
import {
  createCacheCoordinatorPageAdapter,
  type DedicatedWorkerLike,
} from '../coordinator-page-adapter';
import type {
  ProductionHarnessCommand,
  ProductionHarnessEnvelope,
} from './production-browser-wire';

const parameters = new URLSearchParams(location.search);
const tabId = parameters.get('tabId') ?? '';
const scope = parameters.get('scope') ?? '';
if (!tabId || !scope) throw new Error('missing production harness parameters');
// Exercise the real coordinator identity even when builds share its script URL.
const buildTime = Number(parameters.get('buildTime') ?? 0);

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

const channel = new BroadcastChannel(
  `graphql-cache-wp08-production-tabs:${scope}`
);
const report = (
  event: Extract<ProductionHarnessEnvelope, { source: 'tab' }>['event']
): void => {
  channel.postMessage({
    source: 'tab',
    tabId,
    event,
  } satisfies ProductionHarnessEnvelope);
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const failCommand =
  (commandId: string) =>
  (error: unknown): void => {
    report({
      kind: 'command-result',
      commandId,
      ok: false,
      error: errorText(error),
    });
  };
const reportProtocolError = (error: unknown): void => {
  report({ kind: 'protocol-error', error: errorText(error) });
};

let nextRequestId = 1;
let currentWorker: DedicatedWorkerLike | undefined;
const pending = new Map<number, (response: CacheResponse) => void>();

const adapter = createCacheCoordinatorPageAdapter({
  scope,
  tabId,
  buildTime,
  createDedicatedWorker: (_workerScope, ownerEpoch) =>
    new Worker(
      new URL('./production-cache.engine-worker.ts', import.meta.url),
      {
        type: 'module',
        name: `graphql-cache-wp08-production:${scope}:${ownerEpoch}`,
      }
    ),
  onWorkerCreated: (worker, ownerEpoch) => {
    currentWorker = worker;
    report({ kind: 'worker-created', ownerEpoch });
  },
  onWorkerTerminated: (ownerEpoch, reason) => {
    currentWorker = undefined;
    report({ kind: 'worker-terminated', ownerEpoch, reason });
  },
  onProtocolError: (error) => {
    report({ kind: 'protocol-error', error: error.message });
  },
  onCacheUnavailable: (reason) => {
    report({ kind: 'cache-unavailable', reason });
  },
  onCacheSuperseded: (reason) => {
    report({ kind: 'cache-superseded', reason });
    // What the app's host does: leave like a navigating page, which stops
    // this tab's engine so the newer build can open the database.
    adapter
      .dispose({ graceful: false, preserveDatabase: true })
      .catch(reportProtocolError);
  },
});

adapter.onmessage = (event) => {
  const message = event.data;
  if ('kind' in message) return;
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
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
    pending.set(id, resolve);
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

const handleCommand = (command: ProductionHarnessCommand): void => {
  match(command)
    .with({ kind: 'write' }, (value) => {
      sendRequest(value.commandId, {
        kind: 'write',
        query: QUERY,
        operationName: 'Soup',
        variables: VARIABLES,
        data: {
          user: {
            id: 'production-user',
            soup: {
              nextCursor: null,
              items: [{ __typename: 'GraphqlSoupDocument', id: value.value }],
            },
          },
        },
        identity: 'production-test-user',
      }).catch(failCommand(value.commandId));
    })
    .with({ kind: 'read' }, (value) => {
      sendRequest(value.commandId, {
        kind: 'read',
        query: QUERY,
        operationName: 'Soup',
        variables: VARIABLES,
      }).catch(failCommand(value.commandId));
    })
    .with({ kind: 'slow-read' }, (value) => {
      sendRequest(value.commandId, {
        kind: 'read',
        query: SLOW_QUERY,
        operationName: 'Slow',
        variables: VARIABLES,
      }).catch(failCommand(value.commandId));
    })
    .with({ kind: 'graceful-close' }, (value) => {
      adapter
        .dispose({ graceful: true })
        .then(() => {
          report({
            kind: 'command-result',
            commandId: value.commandId,
            ok: true,
          });
          setTimeout(() => window.close());
        })
        .catch(failCommand(value.commandId));
    })
    .with({ kind: 'crash-worker' }, (value) => {
      if (!currentWorker) {
        report({
          kind: 'command-result',
          commandId: value.commandId,
          ok: false,
          error: 'tab has no production worker',
        });
        return;
      }
      currentWorker.postMessage({ testKind: 'crash' }, []);
      report({ kind: 'command-result', commandId: value.commandId, ok: true });
    })
    .with({ kind: 'arm-mutation-block' }, (value) => {
      if (!currentWorker) {
        report({
          kind: 'command-result',
          commandId: value.commandId,
          ok: false,
          error: 'tab has no production worker',
        });
        return;
      }
      currentWorker.postMessage(
        { testKind: 'arm-mutation-block', requestKind: value.requestKind },
        []
      );
      report({ kind: 'command-result', commandId: value.commandId, ok: true });
    })
    .with({ kind: 'request' }, (value) => {
      sendRequest(value.commandId, value.request).catch(
        failCommand(value.commandId)
      );
    })
    .with({ kind: 'terminate-worker' }, (value) => {
      if (!currentWorker) {
        report({
          kind: 'command-result',
          commandId: value.commandId,
          ok: false,
          error: 'tab has no production worker',
        });
        return;
      }
      currentWorker.terminate();
      report({ kind: 'command-result', commandId: value.commandId, ok: true });
    })
    .with({ kind: 'navigate-away' }, (value) => {
      (async () => {
        await adapter.dispose({ graceful: false, preserveDatabase: true });
        report({
          kind: 'command-result',
          commandId: value.commandId,
          ok: true,
        });
        setTimeout(() => window.close());
      })().catch(failCommand(value.commandId));
    })
    .exhaustive();
};

channel.onmessage = (event: MessageEvent<ProductionHarnessEnvelope>) => {
  const message = event.data;
  if (message.source === 'harness' && message.targetTabId === tabId) {
    handleCommand(message.command);
  }
};

adapter.postMessage({ id: nextRequestId++, kind: 'init', scope });
adapter
  .start()
  .then(() => report({ kind: 'registered' }))
  .catch(reportProtocolError);
