import {
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
 * acknowledges the queue installing it.
 */
export function fakeClient(
  answer: (variables: unknown) => Answer | Promise<Answer>
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
  // Transactions the queue still holds, as `inspectMutations` lists them.
  const queued: string[] = [];
  const host: ChannelWriteHost = {
    readRecordsByKeys: device.readRecordsByKeys,
    async inspectMutations() {
      return queued.map(
        (transactionId) =>
          ({ transactionId }) as Awaited<
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
    listeners,
    queued,
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

export function setup(
  answer: (variables: unknown) => Answer | Promise<Answer>,
  records: ChannelMessageFieldsFragment[] = []
) {
  const { client, calls } = fakeClient(answer);
  const device = writeHost(records);
  const runtime = { notifyChanged: vi.fn() };
  const writes = createChannelWrites({
    host: device.host,
    runtime,
    client: () => client,
    now: () => NOW,
  });
  return { writes, calls, runtime, ...device };
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
