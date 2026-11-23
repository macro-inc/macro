import { thrownResultErrorHasCode } from '@core/util/result';
import { describe, expect, it, vi } from 'vitest';
import {
  channelMessageKey,
  mapChannelMessage,
  unplacedSortKey,
} from '../channel-map';
import { CHANNEL_ID, graphqlMessage } from './fixtures';
import { NOW, refused, SENDER, send, setup, written } from './write-fixtures';

vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@macro-inc/observability')>()),
  Telemetry: {
    error: vi.fn(),
    span: async (_name: string, run: (span: unknown) => unknown) =>
      run({ setAttr: () => undefined }),
    captureContext: () => ({ run: <T>(operation: () => T) => operation() }),
  },
}));

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

  it('resolves a send another tab delivered while this page was away', async () => {
    const stored = graphqlMessage(7);
    const { writes, queued, restore, listeners } = setup(
      () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
      [stored]
    );
    queued.push('4');
    const sending = writes.send(send(stored.id));
    await settleMicrotasks();

    // Back from the back/forward cache: the queue no longer holds it, and
    // its settlement went to the page while it was suspended.
    queued.length = 0;
    restore();

    await expect(sending).resolves.toEqual(mapChannelMessage(stored));
    expect(listeners.size).toBe(0);
    expect(writes.pendingCount(CHANNEL_ID)).toBe(0);
  });

  it('rejects a send the queue rolled back while this page was away', async () => {
    const { writes, queued, restore } = setup(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    queued.push('4');
    const sending = writes.send(send(graphqlMessage(7).id));
    await settleMicrotasks();
    queued.length = 0;
    restore();

    const error = await sending.catch((thrown: unknown) => thrown);
    expect(thrownResultErrorHasCode(error, 'NOT_SENT')).toBe(true);
  });

  it('keeps waiting for a write still queued when the page comes back', async () => {
    const stored = graphqlMessage(7);
    const { writes, queued, restore, settle } = setup(
      () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
      [stored]
    );
    queued.push('4');
    const sending = writes.send(send(stored.id));
    await settleMicrotasks();
    restore();
    await settleMicrotasks();
    expect(writes.pendingCount(CHANNEL_ID)).toBe(1);

    settle({ transactionId: '4', status: 'committed' });
    await expect(sending).resolves.toEqual(mapChannelMessage(stored));
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
