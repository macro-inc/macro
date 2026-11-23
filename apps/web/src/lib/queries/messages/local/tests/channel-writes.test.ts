import { thrownResultErrorHasCode } from '@core/util/result';
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
import { describe, expect, it, vi } from 'vitest';
import {
  channelMessageKey,
  mapChannelMessage,
  unplacedSortKey,
} from '../channel-map';
import {
  type ChannelSend,
  type ChannelWriteHost,
  createChannelWrites,
} from '../channel-writes';
import { CHANNEL_ID, fakeHost, graphqlMessage } from './fixtures';

vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@macro-inc/observability')>()),
  Telemetry: {
    error: vi.fn(),
    span: async (_name: string, run: (span: unknown) => unknown) =>
      run({ setAttr: () => undefined }),
  },
}));

const NOW = new Date('2026-11-01T10:00:07.000Z');
const SENDER = 'macro|sender@example.test';

type Answer = Partial<OperationResult> & {
  disposition?: Parameters<typeof withOptimisticMutationDisposition>[1];
};

type Call = {
  variables: { input: Record<string, unknown> };
  context: OptimisticMutationContext;
};

/**
 * A client that answers each mutation from `answer`, records the call and
 * acknowledges the queue installing it.
 */
function fakeClient(answer: (variables: unknown) => Answer | Promise<Answer>) {
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
function writeHost(records: ChannelMessageFieldsFragment[] = []) {
  const listeners = new Set<(settlement: MutationSettlement) => void>();
  const resets = new Set<(change: CacheGenerationChange) => void>();
  const device = fakeHost([], { records });
  const host: ChannelWriteHost = {
    readRecordsByKeys: device.readRecordsByKeys,
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
    reset() {
      for (const listener of [...resets])
        listener({ storage: 'reset' } as CacheGenerationChange);
    },
    settle(settlement: MutationSettlement) {
      for (const listener of [...listeners]) listener(settlement);
    },
  };
}

function setup(
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

const written = (
  field: string,
  message: ChannelMessageFieldsFragment,
  root: ChannelMessageFieldsFragment | null = null
) => ({
  [field]: { __typename: 'GraphqlChannelMessageWrite', message, root },
});

const send = (
  id: string,
  message: ChannelSend['message'] = { content: 'hello' }
): ChannelSend => ({ channelId: CHANNEL_ID, id, senderId: SENDER, message });

const refused = (code: string) =>
  new CombinedError({
    graphQLErrors: [{ message: 'refused', extensions: { code } }],
  });

const settleMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createChannelWrites', () => {
  it('sends with the message id as queue identity and nonce, predicting the row', async () => {
    const stored = graphqlMessage(7);
    const { writes, calls, listeners } = setup(() => ({
      data: written('sendChannelMessage', stored),
      disposition: { kind: 'committed' },
    }));

    const message = await writes.send(
      send(stored.id, {
        content: 'hello',
        mentions: [{ entity_type: 'user', entity_id: 'macro|a@example.test' }],
        attachments: [{ entity_type: 'document', entity_id: 'doc-1' }],
      })
    );

    expect(message).toEqual(mapChannelMessage(stored));
    expect(listeners.size).toBe(0);
    const [{ variables, context }] = calls;
    expect(variables.input).toEqual({
      channelId: CHANNEL_ID,
      id: stored.id,
      content: 'hello',
      threadId: null,
      mentions: [{ entityType: 'user', entityId: 'macro|a@example.test' }],
      attachments: [
        {
          entityType: 'document',
          entityId: 'doc-1',
          width: null,
          height: null,
        },
      ],
      nonce: stored.id,
    });
    expect(context.uuid).toBe(stored.id);
    expect(context.optimisticResponse).toMatchObject({
      sendChannelMessage: {
        __typename: 'GraphqlChannelMessageWrite',
        root: null,
        message: {
          __typename: 'GraphqlChannelMessage',
          id: stored.id,
          channelId: CHANNEL_ID,
          threadId: null,
          sortKey: unplacedSortKey(NOW.toISOString(), stored.id, false),
          senderId: SENDER,
          content: 'hello',
          deletedAt: null,
          thread: { replyCount: 0, preview: [] },
        },
      },
    });
  });

  it('predicts a reply after its thread and counts it on the root the device holds', async () => {
    const root = graphqlMessage(1, {
      thread: { ...graphqlMessage(1).thread!, replyCount: 2 },
    });
    const reply = graphqlMessage(8, { threadId: root.id });
    const { writes, calls } = setup(
      () => ({
        data: written('sendChannelMessage', reply, root),
        disposition: { kind: 'committed' },
      }),
      [root]
    );

    await writes.send(send(reply.id, { content: 'reply', thread_id: root.id }));

    expect(calls[0].context.optimisticResponse).toMatchObject({
      sendChannelMessage: {
        message: {
          threadId: root.id,
          sortKey: unplacedSortKey(NOW.toISOString(), reply.id, true),
          thread: null,
        },
        root: {
          id: root.id,
          thread: {
            replyCount: 3,
            latestReplyAt: NOW.toISOString(),
          },
        },
      },
    });
  });

  it('shows a waiting reply in its thread, not at the live end', async () => {
    const root = graphqlMessage(1);
    const reply = graphqlMessage(8, { threadId: root.id });
    const { writes, settle } = setup(
      () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
      [root, reply]
    );

    const sending = writes.send(
      send(reply.id, { content: 'reply', thread_id: root.id })
    );
    // The root is read first, to predict its reply count.
    await settleMicrotasks();
    expect(writes.unstoredRoots(CHANNEL_ID)).toEqual([]);
    expect(
      writes.unstoredReplies(CHANNEL_ID, root.id).map((message) => message.id)
    ).toEqual([reply.id]);
    expect(writes.unstoredReplies(CHANNEL_ID, 'other-root')).toEqual([]);

    settle({ transactionId: '4', status: 'committed' });
    await sending;
    expect(writes.unstoredReplies(CHANNEL_ID, root.id)).toEqual([]);
  });

  it('predicts no root for a reply whose root the device does not hold', async () => {
    const reply = graphqlMessage(8, { threadId: graphqlMessage(1).id });
    const { writes, calls } = setup(() => ({
      data: written('sendChannelMessage', reply),
      disposition: { kind: 'committed' },
    }));
    await writes.send(
      send(reply.id, { content: 'r', thread_id: reply.threadId })
    );
    expect(calls[0].context.optimisticResponse).toMatchObject({
      sendChannelMessage: { root: null },
    });
    expect(writes.unstoredRoots(CHANNEL_ID)).toEqual([]);
  });

  it('keeps a held write pending until the queue delivers it, then reads the stored message', async () => {
    const stored = graphqlMessage(7);
    const { writes, settle, listeners, runtime } = setup(
      () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
      [stored]
    );
    let done = false;

    const sending = (async () => {
      try {
        return await writes.send(send(stored.id));
      } finally {
        done = true;
      }
    })();
    expect(writes.pendingCount(CHANNEL_ID)).toBe(1);
    const [shown] = writes.unstoredRoots(CHANNEL_ID);
    expect(shown?.key).toBe(channelMessageKey(stored.id));
    expect(shown?.sortKey).toBe(
      unplacedSortKey(NOW.toISOString(), stored.id, false)
    );
    expect(runtime.notifyChanged).toHaveBeenCalledWith(CHANNEL_ID);

    await settleMicrotasks();
    settle({ transactionId: '3', status: 'committed' });
    await settleMicrotasks();
    expect(done).toBe(false);

    settle({ transactionId: '4', status: 'committed' });
    expect(await sending).toEqual(mapChannelMessage(stored));
    expect(listeners.size).toBe(0);
    expect(writes.pendingCount(CHANNEL_ID)).toBe(0);
    expect(writes.unstoredRoots(CHANNEL_ID)).toEqual([]);
  });

  it('answers with the row it sent when a delivered send cannot be read back', async () => {
    const id = graphqlMessage(7).id;
    const { writes, settle } = setup(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const sending = writes.send(send(id, { content: 'kept' }));
    await settleMicrotasks();
    settle({ transactionId: '4', status: 'committed' });
    const message = await sending;
    expect(message.id).toBe(id);
    expect(message.content).toBe('kept');
  });

  it('does not miss a settlement that lands before the queue answers', async () => {
    const stored = graphqlMessage(7);
    let settleEarly: () => void = () => undefined;
    const { writes, settle } = setup(async () => {
      settleEarly();
      return { disposition: { kind: 'queued', transactionId: '4' } };
    }, [stored]);
    settleEarly = () => settle({ transactionId: '4', status: 'committed' });
    await expect(writes.send(send(stored.id))).resolves.toEqual(
      mapChannelMessage(stored)
    );
  });

  it('follows a write replaced in the queue', async () => {
    const stored = graphqlMessage(7);
    const { writes, settle } = setup(
      () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
      [stored]
    );
    const sending = writes.send(send(stored.id));
    await settleMicrotasks();
    settle({
      transactionId: '4',
      status: 'superseded',
      replacementTransactionId: '9',
    });
    settle({ transactionId: '9', status: 'committed' });
    await expect(sending).resolves.toEqual(mapChannelMessage(stored));
  });

  it('rejects a held write when the device cache is reset', async () => {
    const { writes, reset, listeners } = setup(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const sending = writes.send(send(graphqlMessage(7).id));
    await settleMicrotasks();
    reset();
    const error = await sending.catch((thrown: unknown) => thrown);
    expect(thrownResultErrorHasCode(error, 'CACHE_RESET')).toBe(true);
    expect(listeners.size).toBe(0);
    expect(writes.pendingCount(CHANNEL_ID)).toBe(0);
  });

  it('rejects a held write when its host retires', async () => {
    const { writes, listeners } = setup(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const sending = writes.send(send(graphqlMessage(7).id));
    await settleMicrotasks();
    writes.retire();
    const error = await sending.catch((thrown: unknown) => thrown);
    expect(thrownResultErrorHasCode(error, 'CACHE_RETIRED')).toBe(true);
    expect(listeners.size).toBe(0);
    expect(writes.pendingCount(CHANNEL_ID)).toBe(0);
  });

  it('rejects a held write the server later refuses, with its code', async () => {
    const { writes, settle, runtime } = setup(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const sending = writes.send(send(graphqlMessage(7).id));
    await settleMicrotasks();
    runtime.notifyChanged.mockClear();
    settle({
      transactionId: '4',
      status: 'permanently-failed',
      error: 'forbidden',
      errorCode: 'FORBIDDEN',
    });
    const error = await sending.catch((thrown: unknown) => thrown);
    expect(thrownResultErrorHasCode(error, 'FORBIDDEN')).toBe(true);
    expect(writes.unstoredRoots(CHANNEL_ID)).toEqual([]);
    // The rollback changed the device's copy.
    expect(runtime.notifyChanged).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it('rejects a refused write with the server code', async () => {
    const { writes } = setup(() => ({
      error: refused('NOT_FOUND'),
      disposition: { kind: 'permanently-failed' },
    }));
    const error = await writes
      .remove({ channelId: CHANNEL_ID, id: 'gone', nonce: 'n' })
      .catch((thrown: unknown) => thrown);
    expect(thrownResultErrorHasCode(error, 'NOT_FOUND')).toBe(true);
  });

  it('patches only what an edit, a delete and a reaction change', async () => {
    const stored = graphqlMessage(7);
    const { writes, calls } = setup((variables) => {
      const input = (variables as { input: Record<string, unknown> }).input;
      const field =
        'emoji' in input
          ? 'reactToChannelMessage'
          : 'content' in input
            ? 'editChannelMessage'
            : 'deleteChannelMessage';
      return {
        data: written(field, stored),
        disposition: { kind: 'committed' },
      };
    });

    await writes.edit({
      channelId: CHANNEL_ID,
      id: stored.id,
      content: 'edited',
      mentions: [],
      removeAttachmentIds: ['a-1'],
      addAttachments: [],
      nonce: 'edit-nonce',
    });
    await writes.remove({ channelId: CHANNEL_ID, id: stored.id, nonce: 'd' });
    await writes.react({
      channelId: CHANNEL_ID,
      id: stored.id,
      emoji: '👍',
      add: true,
      reactions: [{ emoji: '👍', users: [SENDER] }],
      nonce: 'r',
    });

    const [edit, remove, react] = calls;
    expect(edit.variables.input).toMatchObject({
      removeAttachmentIds: ['a-1'],
      nonce: 'edit-nonce',
    });
    expect(edit.context.optimisticResponse).toEqual({
      editChannelMessage: {
        __typename: 'GraphqlChannelMessageWrite',
        message: {
          __typename: 'GraphqlChannelMessage',
          id: stored.id,
          content: 'edited',
          mentions: [],
          editedAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      },
    });
    expect(remove.context.optimisticResponse).toEqual({
      deleteChannelMessage: {
        __typename: 'GraphqlChannelMessageWrite',
        message: {
          __typename: 'GraphqlChannelMessage',
          id: stored.id,
          deletedAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      },
    });
    expect(react.context.optimisticResponse).toEqual({
      reactToChannelMessage: {
        __typename: 'GraphqlChannelMessageWrite',
        message: {
          __typename: 'GraphqlChannelMessage',
          id: stored.id,
          reactions: [{ emoji: '👍', users: [SENDER] }],
        },
      },
    });
    // Each edit gets a queue identity of its own.
    expect(new Set(calls.map((call) => call.context.uuid)).size).toBe(3);
    expect(writes.unstoredRoots(CHANNEL_ID)).toEqual([]);
  });
});
