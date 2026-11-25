/// <reference lib="webworker" />

/**
 * The production engine core over real OPFS, without a coordinator: the page
 * that starts it chooses what it opens, and terminates it wherever it likes.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheRequest, CacheResponse } from '../../protocol';
import type { CacheQueueState } from '../coordinator-protocol';
import type { CacheOpenOutcome } from '../wasm-module';
import { CacheWorkerCore } from '../worker-core';

export type QueueSalvageCommand =
  | { kind: 'open'; scope: string; recovery: boolean }
  | { kind: 'request'; request: CacheRequest }
  | { kind: 'close' };

export type QueueSalvageEvent =
  | { kind: 'loaded' }
  | { kind: 'owner-lock' }
  | {
      kind: 'opened';
      outcome: CacheOpenOutcome;
      queue: CacheQueueState;
      /** What telemetry says of a queue that crossed. */
      crossing: string;
    }
  | { kind: 'open-failed'; error: string }
  | { kind: 'response'; response: CacheResponse }
  | { kind: 'closed' };

const worker = self as unknown as DedicatedWorkerGlobalScope;
const send = (event: QueueSalvageEvent): void => worker.postMessage(event);
const port = {
  postMessage: (message: unknown) => {
    if (typeof message === 'object' && message !== null && 'id' in message)
      send({ kind: 'response', response: message as CacheResponse });
  },
};
const OWNER_LOCK_RETRY_MS = 20;
let core: CacheWorkerCore | undefined;

async function open(scope: string, recovery: boolean): Promise<void> {
  let opened: Extract<QueueSalvageEvent, { kind: 'opened' }> | undefined;
  let crossing = 'none';
  core = new CacheWorkerCore({
    recoveryOpen: recovery,
    onInitializationOutcome: (outcome, queue) => {
      opened = { kind: 'opened', outcome, queue, crossing };
    },
    telemetry: {
      record: (observation) => {
        const { name, queueOutcome, queueKept, queueDropped } = observation;
        if (name !== 'graphql_cache.schema_init' || !queueOutcome) return;
        crossing = `${queueOutcome} ${queueKept} ${queueDropped}`;
      },
      flush: () => undefined,
    },
    onOwnerLockAcquired: async () => send({ kind: 'owner-lock' }),
    onOwnerLockBusy: async () => {
      await new Promise((resolve) => setTimeout(resolve, OWNER_LOCK_RETRY_MS));
    },
  });
  let error = 'the engine did not answer its init';
  await core.handleRequest(
    {
      postMessage: (message: unknown) => {
        const response = message as CacheResponse;
        if (!response.ok) error = response.error;
      },
    },
    { id: 0, kind: 'init', scope }
  );
  core.addPort(port);
  send(opened ? { ...opened, crossing } : { kind: 'open-failed', error });
}

async function handle(command: QueueSalvageCommand): Promise<void> {
  if (command.kind === 'open') {
    await open(command.scope, command.recovery);
    return;
  }
  if (command.kind === 'request') {
    await core?.handleRequest(port, command.request);
    return;
  }
  await core?.drain();
  send({ kind: 'closed' });
}

worker.onmessage = ({ data }: MessageEvent<QueueSalvageCommand>) => {
  fireAndForget(handle(data), 'queue-salvage.engine-worker');
};
send({ kind: 'loaded' });
