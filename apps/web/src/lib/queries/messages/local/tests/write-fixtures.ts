import {
  notifyOptimisticMutationEnqueued,
  type OptimisticMutationContext,
  optimisticContextOf,
  withOptimisticMutationDisposition,
} from '@graphql-cache/exchange/optimistic';
import type { CacheGenerationChange } from '@graphql-cache/host/types';
import type { MutationSettlement } from '@graphql-cache/protocol';
import type { ChannelMessageFieldsFragment } from '@service-storage/graphql/generated/graphql';
import {
  type Client,
  CombinedError,
  type Operation,
  type OperationResult,
  type OperationResultSource,
} from '@urql/core';
import { vi } from 'vitest';
import {
  type ChannelSend,
  type ChannelWriteHost,
  createChannelWrites,
} from '../channel-writes';
import { CHANNEL_ID, fakeHost } from './fixtures';

export const NOW = new Date('2026-11-01T10:00:07.000Z');
export const SENDER = 'macro|sender@example.test';

export type Answer = Partial<OperationResult> & {
  disposition?: Parameters<typeof withOptimisticMutationDisposition>[1];
};

export type Call = {
  variables: { input: Record<string, unknown> };
  context: OptimisticMutationContext;
};

/**
 * A client that answers each mutation from `answer`, records the call and
 * acknowledges the queue installing it, once `installed` settles.
 */
export function fakeClient(
  answer: (variables: unknown) => Answer | Promise<Answer>,
  installed: () => Promise<void> | undefined = () => undefined
) {
  const calls: Call[] = [];
  const client = {
    mutation(_document: unknown, variables: never, context: never) {
      const operation = { context } as unknown as Operation;
      const optimistic = optimisticContextOf(operation);
      if (!optimistic) throw new Error('not an optimistic mutation');
      calls.push({ variables, context: optimistic });
      return {
        toPromise: async () => {
          const installing = installed();
          if (installing) await installing;
          notifyOptimisticMutationEnqueued(operation);
          const { disposition, ...result } = await answer(variables);
          const base = {
            operation,
            stale: false,
            hasNext: false,
            ...result,
          } as OperationResult;
          return disposition
            ? withOptimisticMutationDisposition(base, disposition)
            : base;
        },
      } as OperationResultSource<OperationResult>;
    },
  } as unknown as Client;
  return { client, calls };
}

/** A host holding `records` whose queue settles when the test says so. */
export function writeHost(records: ChannelMessageFieldsFragment[] = []) {
  const listeners = new Set<(settlement: MutationSettlement) => void>();
  const resets = new Set<(change: CacheGenerationChange) => void>();
  const device = fakeHost([], { records });
  // Transactions the queue still holds, as `inspectMutations` lists them: a
  // bare id is the last write handed over, an entry names its own mutation.
  const queued: (string | { transactionId: string; uuid: string })[] = [];
  // Set to make the queue unreadable, as an engine that did not come back;
  // `failures` fails only that many reads. `installing` holds the queue's
  // acknowledgement of the writes handed over meanwhile.
  const queue = {
    unreadable: false,
    failures: 0,
    lastUuid: '',
    installing: undefined as Promise<void> | undefined,
  };
  // `serving` is false from an outage until the queue has been read again.
  const availability = { paused: false, serving: true };
  const host: ChannelWriteHost = {
    get paused() {
      return availability.paused;
    },
    readRecordsByKeys: device.readRecordsByKeys,
    async inspectMutations() {
      if (queue.unreadable) throw new Error('queue unreadable');
      if (queue.failures > 0) {
        queue.failures -= 1;
        throw new Error('queue busy');
      }
      return queued.map(
        (entry) =>
          (typeof entry === 'string'
            ? { transactionId: entry, uuid: queue.lastUuid }
            : entry) as Awaited<
            ReturnType<NonNullable<ChannelWriteHost['inspectMutations']>>
          >[number]
      );
    },
    onMutationSettled(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onCacheGenerationChanged(listener) {
      resets.add(listener);
      return () => resets.delete(listener);
    },
  };
  return {
    host,
    device,
    availability,
    listeners,
    queued,
    queue,
    /** The engine comes back with its storage kept, as after Back. */
    restore() {
      for (const listener of [...resets])
        listener({ storage: 'preserved' } as CacheGenerationChange);
    },
    reset() {
      for (const listener of [...resets])
        listener({ storage: 'reset' } as CacheGenerationChange);
    },
    settle(settlement: MutationSettlement) {
      for (const listener of [...listeners]) listener(settlement);
    },
  };
}

/**
 * Writes over a fake client and device. `server` holds the messages the
 * server answers a single-message read with; `fetched` lists those reads.
 */
export function setup(
  answer: (variables: unknown) => Answer | Promise<Answer>,
  records: ChannelMessageFieldsFragment[] = [],
  server: ChannelMessageFieldsFragment[] = []
) {
  const device = writeHost(records);
  const { client, calls } = fakeClient(
    (variables) => {
      device.queue.lastUuid = calls.at(-1)?.context.uuid ?? '';
      return answer(variables);
    },
    () => device.queue.installing
  );
  const runtime = { notifyChanged: vi.fn() };
  const fetched: string[] = [];
  const writes = createChannelWrites({
    host: device.host,
    runtime,
    client: () => client,
    now: () => NOW,
    serving: () => device.availability.serving,
    async fetchMessage(_channelId, messageId) {
      fetched.push(messageId);
      return server.find((message) => message.id === messageId) ?? null;
    },
  });
  /** The cache's database is away for now. */
  const startOutage = () => {
    device.availability.paused = true;
    device.availability.serving = false;
  };
  const endOutage = () => {
    device.availability.paused = false;
    device.availability.serving = true;
    writes.resumed();
  };
  return { writes, calls, runtime, fetched, startOutage, endOutage, ...device };
}

export const written = (
  field: string,
  message: ChannelMessageFieldsFragment,
  root: ChannelMessageFieldsFragment | null = null
) => ({
  [field]: { __typename: 'GraphqlChannelMessageWrite', message, root },
});

export const send = (
  id: string,
  message: ChannelSend['message'] = { content: 'hello' }
): ChannelSend => ({ channelId: CHANNEL_ID, id, senderId: SENDER, message });

export const refused = (code: string) =>
  new CombinedError({
    graphQLErrors: [{ message: 'refused', extensions: { code } }],
  });
