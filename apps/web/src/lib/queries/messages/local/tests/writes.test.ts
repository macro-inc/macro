import { ThrownResultError } from '@core/util/result';
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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapChannelMessage } from '../map';
import { readDeviceChannelPage } from '../pages';
import { unplacedSortKey } from '../sort-key';
import { resetUnsettledReplies } from '../unsettled-replies';
import {
  type ChannelWriteHost,
  deleteChannelMessage,
  editChannelMessage,
  reactToChannelMessage,
  sendChannelMessage,
  WAITING_ANNOUNCE_MS,
} from '../writes';
import {
  CHANNEL_ID,
  devicePage,
  fakeHost,
  graphqlMessage,
  keyOf,
} from './fixtures';

const { pageIsLeaving } = vi.hoisted(() => ({
  pageIsLeaving: vi.fn(() => false),
}));
vi.mock('../unqueued-sends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../unqueued-sends')>()),
  pageIsLeaving,
}));
const { announceWaitingWrite } = vi.hoisted(() => ({
  announceWaitingWrite: vi.fn(),
}));
vi.mock('../waiting-writes', () => ({ announceWaitingWrite }));
afterEach(() => {
  pageIsLeaving.mockReturnValue(false);
  announceWaitingWrite.mockClear();
});

const NOW = new Date('2026-11-01T10:00:07.000Z');
const SENDER = 'macro|sender@example.test';

type Answer = Partial<OperationResult> & {
  disposition?: Parameters<typeof withOptimisticMutationDisposition>[1];
};

/** A client that answers each mutation from `answer` and records the call. */
function fakeClient(answer: (variables: unknown) => Answer) {
  const calls: {
    variables: { input: Record<string, unknown> };
    context: OptimisticMutationContext;
  }[] = [];
  const client = {
    mutation(_document: unknown, variables: never, context: never) {
      const operation = { context } as unknown as Operation;
      const optimistic = optimisticContextOf(operation);
      if (!optimistic) throw new Error('not an optimistic mutation');
      calls.push({ variables, context: optimistic });
      const { disposition, ...result } = answer(variables);
      const base = {
        operation,
        stale: false,
        hasNext: false,
        ...result,
      } as OperationResult;
      const settled = disposition
        ? withOptimisticMutationDisposition(base, disposition)
        : base;
      return {
        toPromise: async () => settled,
      } as OperationResultSource<OperationResult>;
    },
  } as unknown as Client;
  return { client, calls };
}

/** A host holding `records` whose queue settles when the test says so. */
function writeHost(records: ChannelMessageFieldsFragment[] = []) {
  const listeners = new Set<(settlement: MutationSettlement) => void>();
  const resets = new Set<(change: CacheGenerationChange) => void>();
  const host: ChannelWriteHost = {
    readRecordsByKeys: fakeHost([], { records }).readRecordsByKeys,
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
    listeners,
    reset() {
      for (const listener of [...resets]) listener({ storage: 'reset' });
    },
    settle(settlement: MutationSettlement) {
      for (const listener of [...listeners]) listener(settlement);
    },
  };
}

const refused = (code: string) =>
  new CombinedError({
    graphQLErrors: [{ message: 'refused', extensions: { code } }],
  });

describe('queued channel writes', () => {
  it('sends with the message id as queue identity and nonce, predicting the row', async () => {
    const stored = graphqlMessage(7);
    const { client, calls } = fakeClient(() => ({
      data: { sendChannelMessage: stored },
      disposition: { kind: 'committed' },
    }));
    const { host, listeners } = writeHost();

    const message = await sendChannelMessage(
      host,
      {
        channelId: CHANNEL_ID,
        id: stored.id,
        senderId: SENDER,
        message: {
          content: 'hello',
          mentions: [
            { entity_type: 'user', entity_id: 'macro|a@example.test' },
          ],
          attachments: [{ entity_type: 'document', entity_id: 'doc-1' }],
        },
      },
      { client, now: () => NOW }
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
    });
  });

  it('predicts a reply after its thread, without a thread summary', async () => {
    const root = graphqlMessage(1);
    const reply = graphqlMessage(8, { threadId: root.id });
    const { client, calls } = fakeClient(() => ({
      data: { sendChannelMessage: reply },
      disposition: { kind: 'committed' },
    }));

    await sendChannelMessage(
      writeHost().host,
      {
        channelId: CHANNEL_ID,
        id: reply.id,
        senderId: SENDER,
        message: { content: 'reply', thread_id: root.id },
      },
      { client, now: () => NOW }
    );

    expect(calls[0].context.optimisticResponse).toMatchObject({
      sendChannelMessage: {
        threadId: root.id,
        sortKey: unplacedSortKey(NOW.toISOString(), reply.id, true),
        thread: null,
      },
    });
  });

  it('keeps a held write pending until the queue delivers it, then reads the stored message', async () => {
    const stored = graphqlMessage(7);
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const { host, settle, listeners } = writeHost([stored]);
    let done = false;

    const sending = sendChannelMessage(
      host,
      {
        channelId: CHANNEL_ID,
        id: stored.id,
        senderId: SENDER,
        message: { content: 'hello' },
      },
      { client }
    ).finally(() => {
      done = true;
    });
    await Promise.resolve();
    settle({ transactionId: '3', status: 'committed' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(done).toBe(false);

    settle({ transactionId: '4', status: 'committed' });
    expect(await sending).toEqual(mapChannelMessage(stored));
    expect(listeners.size).toBe(0);
  });

  it("tells the device's other windows of a write the queue still holds after a moment", async () => {
    vi.useFakeTimers();
    try {
      const { client } = fakeClient(() => ({
        disposition: { kind: 'queued', transactionId: '4' },
      }));
      const { host, settle } = writeHost([graphqlMessage(7)]);
      const send = () =>
        sendChannelMessage(
          host,
          {
            channelId: CHANNEL_ID,
            id: graphqlMessage(7).id,
            senderId: SENDER,
            message: { content: 'hello' },
          },
          { client }
        );

      const delivered = send();
      await vi.advanceTimersByTimeAsync(WAITING_ANNOUNCE_MS - 1);
      settle({ transactionId: '4', status: 'committed' });
      await delivered;
      await vi.advanceTimersByTimeAsync(WAITING_ANNOUNCE_MS);
      expect(announceWaitingWrite).not.toHaveBeenCalled();

      const held = send();
      await vi.advanceTimersByTimeAsync(WAITING_ANNOUNCE_MS);
      expect(announceWaitingWrite).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID);
      settle({ transactionId: '4', status: 'committed' });
      await held;
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers with the row it sent when a delivered send cannot be read back', async () => {
    const id = graphqlMessage(7).id;
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const { host, settle } = writeHost();

    const sending = sendChannelMessage(
      host,
      {
        channelId: CHANNEL_ID,
        id,
        senderId: SENDER,
        message: { content: 'hello' },
      },
      { client, now: () => NOW }
    );
    await Promise.resolve();
    settle({ transactionId: '4', status: 'committed' });

    expect(await sending).toMatchObject({ id, content: 'hello' });
  });

  it('rejects a held write when the device cache is reset', async () => {
    const stored = graphqlMessage(7);
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const { host, reset, listeners } = writeHost([stored]);

    const sending = sendChannelMessage(
      host,
      {
        channelId: CHANNEL_ID,
        id: stored.id,
        senderId: SENDER,
        message: { content: 'hello' },
      },
      { client }
    );
    await Promise.resolve();
    reset();

    await expect(sending).rejects.toMatchObject({
      errors: [{ code: 'CACHE_RESET' }],
    });
    expect(listeners.size).toBe(0);
  });

  it('does not miss a settlement that lands before the queue answers', async () => {
    const stored = graphqlMessage(7);
    const world = writeHost([stored]);
    const { client } = fakeClient(() => {
      world.settle({ transactionId: '4', status: 'committed' });
      return { disposition: { kind: 'queued', transactionId: '4' } };
    });

    const message = await deleteChannelMessage(
      world.host,
      { channelId: CHANNEL_ID, id: stored.id, nonce: 'n' },
      { client }
    );
    expect(message.id).toBe(stored.id);
  });

  it('follows a write replaced in the queue', async () => {
    const stored = graphqlMessage(7);
    const world = writeHost([stored]);
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));

    const editing = editChannelMessage(
      world.host,
      {
        channelId: CHANNEL_ID,
        id: stored.id,
        content: 'edited',
        mentions: [],
        removeAttachmentIds: [],
        addAttachments: [],
        nonce: 'n',
      },
      { client }
    );
    await Promise.resolve();
    world.settle({
      transactionId: '4',
      status: 'superseded',
      replacementTransactionId: '5',
    });
    world.settle({ transactionId: '5', status: 'committed' });
    expect((await editing).id).toBe(stored.id);
  });

  it('rejects a held write the server later refuses, with its code', async () => {
    const world = writeHost();
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));

    const reacting = reactToChannelMessage(
      world.host,
      { channelId: CHANNEL_ID, id: 'm', emoji: '👍', add: true, nonce: 'n' },
      { client }
    );
    await Promise.resolve();
    world.settle({
      transactionId: '4',
      status: 'permanently-failed',
      error: 'not allowed',
      errorCode: 'FORBIDDEN',
    });

    await expect(reacting).rejects.toMatchObject({
      errors: [{ code: 'FORBIDDEN', message: 'not allowed' }],
    });
    expect(world.listeners.size).toBe(0);
  });

  it('rejects a refused write with the server code', async () => {
    const { client } = fakeClient(() => ({
      error: refused('SERVICE_UNAVAILABLE'),
      disposition: { kind: 'permanently-failed' },
    }));

    const failure = await deleteChannelMessage(
      writeHost().host,
      { channelId: CHANNEL_ID, id: 'm', nonce: 'n' },
      { client }
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ThrownResultError);
    expect((failure as ThrownResultError).errors[0].code).toBe(
      'SERVICE_UNAVAILABLE'
    );
  });

  it('keeps a send pending when it fails because the page is being left', async () => {
    let leaving = false;
    const { client } = fakeClient(() => {
      // The mark lands after the failure, as it does when the cache host's
      // listener runs first.
      if (leaving) setTimeout(() => pageIsLeaving.mockReturnValue(true), 0);
      return {
        error: refused('SERVICE_UNAVAILABLE'),
        disposition: { kind: 'permanently-failed' },
      };
    });
    const send = () =>
      sendChannelMessage(
        writeHost().host,
        {
          channelId: CHANNEL_ID,
          id: graphqlMessage(7).id,
          senderId: SENDER,
          message: { content: 'hello' },
        },
        { client, now: () => NOW }
      );
    await expect(send()).rejects.toBeInstanceOf(ThrownResultError);

    leaving = true;
    const settled = async () => {
      try {
        await send();
      } catch {
        // Settled either way.
      }
      return 'settled';
    };
    const outcome = await Promise.race([
      settled(),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ]);
    expect(outcome).toBe('pending');
  });

  it('patches only what an edit, a delete and a reaction change', async () => {
    const stored = graphqlMessage(7);
    const { client, calls } = fakeClient((variables) => {
      const { input } = variables as { input: Record<string, unknown> };
      const field =
        'emoji' in input
          ? 'reactToChannelMessage'
          : 'content' in input
            ? 'editChannelMessage'
            : 'deleteChannelMessage';
      return { data: { [field]: stored }, disposition: { kind: 'committed' } };
    });
    const { host } = writeHost();
    const deps = { client, now: () => NOW };
    const at = NOW.toISOString();

    await editChannelMessage(
      host,
      {
        channelId: CHANNEL_ID,
        id: stored.id,
        content: 'edited',
        mentions: [],
        removeAttachmentIds: ['a1'],
        addAttachments: [],
        nonce: 'e',
      },
      deps
    );
    await deleteChannelMessage(
      host,
      { channelId: CHANNEL_ID, id: stored.id, nonce: 'd' },
      deps
    );
    await reactToChannelMessage(
      host,
      {
        channelId: CHANNEL_ID,
        id: stored.id,
        emoji: '👍',
        add: true,
        reactions: [{ emoji: '👍', users: [SENDER] }],
        nonce: 'r',
      },
      deps
    );

    expect(calls.map((call) => call.context.optimisticResponse)).toEqual([
      {
        editChannelMessage: {
          __typename: 'GraphqlChannelMessage',
          id: stored.id,
          content: 'edited',
          mentions: [],
          editedAt: at,
          updatedAt: at,
        },
      },
      {
        deleteChannelMessage: {
          __typename: 'GraphqlChannelMessage',
          id: stored.id,
          deletedAt: at,
          updatedAt: at,
        },
      },
      {
        reactToChannelMessage: {
          __typename: 'GraphqlChannelMessage',
          id: stored.id,
          reactions: [{ emoji: '👍', users: [SENDER] }],
        },
      },
    ]);
    expect(calls[0].variables.input).toMatchObject({
      removeAttachmentIds: ['a1'],
      addAttachments: [],
      nonce: 'e',
    });
    expect(new Set(calls.map((call) => call.context.uuid)).size).toBe(3);
  });
});

describe('a reply and the page of its root', () => {
  const replyOn = async (answer: Answer) => {
    resetUnsettledReplies();
    const root = graphqlMessage(1);
    const reply = graphqlMessage(8, { threadId: root.id });
    const { client } = fakeClient(() => answer);
    const outcome = await sendChannelMessage(
      writeHost().host,
      {
        channelId: CHANNEL_ID,
        id: reply.id,
        senderId: SENDER,
        message: { content: 'reply', thread_id: root.id },
      },
      { client, now: () => NOW }
    ).catch((error: unknown) => error);
    // The device holds the delivered reply; its root is as it was before.
    const read = await readDeviceChannelPage(
      fakeHost([devicePage([keyOf(root)])], {
        records: outcome instanceof Error ? [root] : [root, reply],
      }),
      { channelId: CHANNEL_ID, limit: 50 }
    );
    if (read.kind !== 'page') throw new Error(`device answered ${read.kind}`);
    const entry = read.page.entries[0];
    if (entry?.type !== 'message') throw new Error('no root on the page');
    return { reply, thread: entry.message.thread };
  };

  it('keeps a sent reply under a root the device has not brought up to date', async () => {
    const reply = graphqlMessage(8, { threadId: graphqlMessage(1).id });
    const { thread } = await replyOn({
      data: { sendChannelMessage: reply },
      disposition: { kind: 'committed' },
    });

    expect(thread.reply_count).toBe(1);
    expect(thread.preview.map((shown) => shown.id)).toEqual([reply.id]);
  });

  it('takes a refused reply off its root', async () => {
    const { thread } = await replyOn({
      error: refused('FORBIDDEN'),
      disposition: { kind: 'permanently-failed' },
    });

    expect(thread.reply_count).toBe(0);
  });
});
