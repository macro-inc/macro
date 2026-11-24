import { thrownResultErrorHasCode } from '@core/util/result';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  channelMessageKey,
  mapChannelMessage,
  unplacedSortKey,
} from '../channel-map';
import { createChannelWrites } from '../channel-writes';
import { CHANNEL_ID, graphqlMessage } from './fixtures';
import {
  fakeClient,
  NOW,
  refused,
  SENDER,
  send,
  setup,
  writeHost,
  written,
} from './write-fixtures';

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

/** Waits for a write whose answer the test does not check. */
const settled = async (write: Promise<unknown>) => {
  try {
    await write;
  } catch {
    // Only what the write sent is checked.
  }
};

/** What a write failed with, or undefined when it did not fail. */
const failure = async (write: Promise<unknown>): Promise<unknown> => {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
};

// A test that times out under fake timers would leave them on for the next.
afterEach(() => {
  vi.useRealTimers();
});

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

  it('tells the other tabs once a write changed the device', async () => {
    const stored = graphqlMessage(7);
    const { writes } = setup(() => ({
      data: written('sendChannelMessage', stored),
      disposition: { kind: 'committed' },
    }));
    const heard: unknown[] = [];
    const other = new BroadcastChannel('macro.channel-timeline.writes');
    other.onmessage = (event) => heard.push(event.data);

    await writes.send(send(stored.id));
    await vi.waitFor(() =>
      expect(heard).toContainEqual(
        expect.objectContaining({ channelIds: [CHANNEL_ID] })
      )
    );
    other.close();
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

  it("predicts a reply into its root's preview while the preview holds every reply", async () => {
    const root = graphqlMessage(1);
    const reply = graphqlMessage(8, { threadId: root.id });
    const full = graphqlMessage(2, {
      thread: {
        ...graphqlMessage(2).thread!,
        replyCount: 3,
        preview: [3, 4, 5].map((n) =>
          graphqlMessage(n, { threadId: graphqlMessage(2).id })
        ),
      },
    });
    const { writes, calls } = setup(
      () => ({
        data: written('sendChannelMessage', reply, root),
        disposition: { kind: 'committed' },
      }),
      [root, full]
    );

    // The preview is the root's oldest three replies: a collapsed thread
    // shows it, and with no connection the thread itself may not load.
    await writes.send(send(reply.id, { content: 'reply', thread_id: root.id }));
    await writes.send(send(reply.id, { content: 'reply', thread_id: full.id }));

    const previewOf = (call: (typeof calls)[number]) =>
      (
        call.context.optimisticResponse as {
          sendChannelMessage: {
            root: { thread: { preview: { id: string }[] } };
          };
        }
      ).sendChannelMessage.root.thread.preview.map((message) => message.id);
    expect(previewOf(calls[0])).toEqual([reply.id]);
    expect(previewOf(calls[1])).toEqual(
      full.thread!.preview.map((message) => message.id)
    );
  });

  it("takes a deleted reply out of its root's preview and count", async () => {
    const rootId = graphqlMessage(2).id;
    const replies = [3, 4].map((n) => graphqlMessage(n, { threadId: rootId }));
    const root = graphqlMessage(2, {
      thread: {
        ...graphqlMessage(2).thread!,
        replyCount: 2,
        preview: replies,
      },
    });
    const gone = graphqlMessage(5, {
      threadId: rootId,
      deletedAt: NOW.toISOString(),
    });
    const top = graphqlMessage(6);
    const { writes, calls } = setup(
      () => ({ disposition: { kind: 'committed' } }),
      [root, ...replies, gone, top]
    );
    const removal = (id: string) => ({ channelId: CHANNEL_ID, id, nonce: 'd' });

    // A collapsed thread shows the preview, and with no connection the
    // server's root does not come until the delete is sent.
    await writes.remove(removal(replies[0]!.id)).catch(() => undefined);
    await writes.remove(removal(gone.id)).catch(() => undefined);
    await writes.remove(removal(top.id)).catch(() => undefined);

    const rootOf = (call: (typeof calls)[number]) =>
      (
        call.context.optimisticResponse as {
          deleteChannelMessage: {
            root?: {
              thread: { replyCount: number; preview: { id: string }[] };
            };
          };
        }
      ).deleteChannelMessage.root;
    expect(rootOf(calls[0])?.thread.replyCount).toBe(1);
    expect(rootOf(calls[0])?.thread.preview.map((m) => m.id)).toEqual([
      replies[1]!.id,
    ]);
    // Already deleted, it is in neither; a top-level message has no root.
    expect(rootOf(calls[1])).toBeUndefined();
    expect(rootOf(calls[2])).toBeUndefined();
  });

  it('gives the root the latest live reply’s time once its newest reply is deleted', async () => {
    const rootId = graphqlMessage(2).id;
    const replies = [3, 4, 5].map((n) =>
      graphqlMessage(n, { threadId: rootId })
    );
    const thread = (count: number, preview = replies) =>
      graphqlMessage(2, {
        thread: {
          ...graphqlMessage(2).thread!,
          replyCount: count,
          latestReplyAt: replies.at(-1)!.createdAt,
          preview,
        },
      });
    const deleteNewest = async (root: ReturnType<typeof graphqlMessage>) => {
      const { writes, calls } = setup(
        () => ({ disposition: { kind: 'committed' } }),
        [root, ...replies]
      );
      await writes
        .remove({ channelId: CHANNEL_ID, id: replies[2]!.id, nonce: 'd' })
        .catch(() => undefined);
      return (
        calls[0]!.context.optimisticResponse as {
          deleteChannelMessage: {
            root?: { thread: { latestReplyAt: string | null } };
          };
        }
      ).deleteChannelMessage.root?.thread.latestReplyAt;
    };

    // The preview holds every reply: the one before it is now the latest.
    expect(await deleteNewest(thread(3))).toBe(replies[1]!.createdAt);
    // A longer thread's latest reply is not on the device: the server's
    // root brings it, and the deleted one's time stays until then.
    expect(await deleteNewest(thread(5))).toBe(replies[2]!.createdAt);
  });

  it('sends a delete without the root when the device is slow to read it', async () => {
    vi.useFakeTimers();
    const rootId = graphqlMessage(2).id;
    const reply = graphqlMessage(3, { threadId: rootId });
    const { writes, calls, host } = setup(
      () => ({ disposition: { kind: 'committed' } }),
      [graphqlMessage(2), reply]
    );
    // The device holds the read; the stored reply stays on screen until the
    // delete is queued, so the delete does not wait for it.
    host.readRecordsByKeys = () => new Promise(() => undefined);

    const removing = settled(
      writes.remove({ channelId: CHANNEL_ID, id: reply.id, nonce: 'd' })
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toHaveLength(1);
    expect(
      (
        calls[0]!.context.optimisticResponse as {
          deleteChannelMessage: { root?: unknown };
        }
      ).deleteChannelMessage.root
    ).toBeUndefined();
    await removing;
  });

  it('reads no root once a delete stopped waiting for its reply', async () => {
    vi.useFakeTimers();
    const rootId = graphqlMessage(2).id;
    const reply = graphqlMessage(3, { threadId: rootId });
    const { writes, calls, host } = setup(
      () => ({ disposition: { kind: 'committed' } }),
      [graphqlMessage(2), reply]
    );
    const read = host.readRecordsByKeys;
    const late = Promise.withResolvers<void>();
    const asked: unknown[] = [];
    host.readRecordsByKeys = async (args) => {
      asked.push(args.keys);
      await late.promise;
      return read(args);
    };

    const removing = settled(
      writes.remove({ channelId: CHANNEL_ID, id: reply.id, nonce: 'd' })
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(1);
    // The reply's read answers after the delete was queued without a root.
    late.resolve();
    await removing;
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toHaveLength(1);
  });

  it('gives the root the newest time in its preview, wherever that reply sits', async () => {
    const rootId = graphqlMessage(2).id;
    const reply = (n: number, createdAt?: string) =>
      graphqlMessage(n, { threadId: rootId, ...(createdAt && { createdAt }) });
    /** The root's latest reply time once the first of `preview` is deleted. */
    const latestAfterDeletingFirst = async (
      preview: ReturnType<typeof graphqlMessage>[]
    ) => {
      const root = graphqlMessage(2, {
        thread: {
          ...graphqlMessage(2).thread!,
          replyCount: preview.length,
          latestReplyAt: null,
          preview,
        },
      });
      const { writes, calls } = setup(
        () => ({ disposition: { kind: 'committed' } }),
        [root, ...preview]
      );
      await writes
        .remove({ channelId: CHANNEL_ID, id: preview[0]!.id, nonce: 'd' })
        .catch(() => undefined);
      return (
        calls[0]!.context.optimisticResponse as {
          deleteChannelMessage: {
            root?: { thread: { latestReplyAt: string | null } };
          };
        }
      ).deleteChannelMessage.root?.thread.latestReplyAt;
    };
    const [first, newest] = [reply(3), reply(4)];

    // Sent from a clock behind the server's: last in the preview, older.
    expect(
      await latestAfterDeletingFirst([first, newest, reply(9, first.createdAt)])
    ).toBe(newest.createdAt);
    // Within one millisecond, the server orders by microsecond.
    const later = reply(8, newest.createdAt.replace('.000123Z', '.000456Z'));
    expect(await latestAfterDeletingFirst([first, newest, later])).toBe(
      later.createdAt
    );
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

  it('stops showing a waiting message once a delete of it waits too', async () => {
    const root = graphqlMessage(1);
    const sent = graphqlMessage(7);
    const reply = graphqlMessage(8, { threadId: root.id });
    let transaction = 3;
    const { writes, settle } = setup(
      () => ({
        disposition: { kind: 'queued', transactionId: String(++transaction) },
      }),
      [root]
    );

    const sending = writes.send(send(sent.id));
    const replying = writes.send(
      send(reply.id, { content: 'reply', thread_id: root.id })
    );
    await settleMicrotasks();
    expect(writes.unstoredRoots(CHANNEL_ID).map((row) => row.key)).toEqual([
      channelMessageKey(sent.id),
    ]);

    // The device hides a deleted root, and its queue holds the delete: the
    // row kept in memory for the send would bring it back.
    const removing = writes.remove({
      channelId: CHANNEL_ID,
      id: sent.id,
      nonce: 'd1',
    });
    const removingReply = writes.remove({
      channelId: CHANNEL_ID,
      id: reply.id,
      nonce: 'd2',
    });
    expect(writes.unstoredRoots(CHANNEL_ID)).toEqual([]);
    expect(writes.unstoredReplies(CHANNEL_ID, root.id)).toEqual([]);

    for (const id of ['4', '5', '6', '7'])
      settle({ transactionId: id, status: 'committed' });
    await Promise.allSettled([sending, replying, removing, removingReply]);
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

  it('rejects a held write when the device cache is reset and its queue cannot be read', async () => {
    const { writes, reset, queue, listeners } = setup(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const sending = writes.send(send(graphqlMessage(7).id));
    await settleMicrotasks();
    queue.unreadable = true;
    reset();
    const error = await sending.catch((thrown: unknown) => thrown);
    expect(thrownResultErrorHasCode(error, 'CACHE_RESET')).toBe(true);
    expect(listeners.size).toBe(0);
    expect(writes.pendingCount(CHANNEL_ID)).toBe(0);
  });

  it('calls a send a reset emptied from the queue that the server lacks unknown', async () => {
    const id = graphqlMessage(7).id;
    const { writes, reset, fetched } = setup(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const sending = writes.send(send(id));
    await settleMicrotasks();
    reset();
    const error = await sending.catch((thrown: unknown) => thrown);
    // The request may still commit: only the same id is safe to send again.
    expect(thrownResultErrorHasCode(error, 'DELIVERY_UNKNOWN')).toBe(true);
    // An empty answer proves nothing either: it asks three times.
    expect(fetched).toEqual([id, id, id]);
  });

  // A host back from the back/forward cache reports a reset without knowing
  // whether its storage changed while it was frozen.
  it('keeps waiting for a write the queue still holds after a reported reset', async () => {
    const stored = graphqlMessage(7);
    const { writes, queued, reset, settle } = setup(
      () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
      [stored]
    );
    queued.push('4');
    const sending = writes.send(send(stored.id));
    await settleMicrotasks();
    reset();
    await settleMicrotasks();
    expect(writes.pendingCount(CHANNEL_ID)).toBe(1);

    settle({ transactionId: '4', status: 'committed' });
    await expect(sending).resolves.toEqual(mapChannelMessage(stored));
  });

  it('checks the queue after a return heard before the write was handed over', async () => {
    const stored = graphqlMessage(7);
    let restoreEarly: () => void = () => undefined;
    const { writes, restore } = setup(async () => {
      // The page comes back while the write is being handed over; the queue
      // has already delivered it from another tab.
      restoreEarly();
      return { disposition: { kind: 'queued', transactionId: '4' } };
    }, [stored]);
    restoreEarly = restore;
    await expect(writes.send(send(stored.id))).resolves.toEqual(
      mapChannelMessage(stored)
    );
  });

  it('resolves a send that left the queue unheard from the server copy', async () => {
    const delivered = graphqlMessage(7);
    const { writes, queued, restore, fetched } = setup(
      () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
      [],
      [delivered]
    );
    queued.push('4');
    const sending = writes.send(send(delivered.id));
    await settleMicrotasks();
    queued.length = 0;
    restore();
    await expect(sending).resolves.toEqual(mapChannelMessage(delivered));
    expect(fetched).toEqual([delivered.id]);
  });

  it('answers with the server copy of a send the queue stopped retrying', async () => {
    const delivered = graphqlMessage(7);
    const { writes, settle } = setup(
      () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
      [],
      [delivered]
    );
    const sending = writes.send(send(delivered.id));
    await settleMicrotasks();
    settle({
      transactionId: '4',
      status: 'permanently-failed',
      errorCode: 'MUTATION_RETRY_EXHAUSTED',
      error: 'stopped after 3 server failures',
    });
    await expect(sending).resolves.toEqual(mapChannelMessage(delivered));
  });

  it('calls a send the queue stopped retrying that the server lacks unknown', async () => {
    const id = graphqlMessage(7).id;
    const { writes, settle, fetched } = setup(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const sending = writes.send(send(id));
    await settleMicrotasks();
    settle({
      transactionId: '4',
      status: 'permanently-failed',
      errorCode: 'MUTATION_RETRY_EXHAUSTED',
      error: 'stopped after 3 server failures',
    });
    const error = await sending.catch((thrown: unknown) => thrown);
    expect(thrownResultErrorHasCode(error, 'DELIVERY_UNKNOWN')).toBe(true);
    expect(fetched).toEqual([id, id, id]);
  });

  it('answers a send the queue stopped retrying from the device copy', async () => {
    // A frame stored the server's row; the queue's own record is rolled back.
    const delivered = graphqlMessage(7);
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const device = writeHost([delivered]);
    const fetchMessage = vi.fn(() => Promise.reject(new Error('offline')));
    const writes = createChannelWrites({
      host: device.host,
      runtime: { notifyChanged: vi.fn() },
      client: () => client,
      now: () => NOW,
      fetchMessage,
    });
    const sending = writes.send(send(delivered.id));
    await settleMicrotasks();
    device.settle({
      transactionId: '4',
      status: 'permanently-failed',
      errorCode: 'MUTATION_RETRY_EXHAUSTED',
      error: 'stopped after 3 server failures',
    });
    await expect(sending).resolves.toEqual(mapChannelMessage(delivered));
    expect(fetchMessage).not.toHaveBeenCalled();
  });

  it('calls a send unknown when the server never answers whether it has it', async () => {
    vi.useFakeTimers();
    const id = graphqlMessage(7).id;
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const device = writeHost();
    const fetchMessage = vi.fn(
      (_channelId: string, _messageId: string, _signal: AbortSignal) =>
        new Promise<never>(() => {})
    );
    const writes = createChannelWrites({
      host: device.host,
      runtime: { notifyChanged: vi.fn() },
      client: () => client,
      now: () => NOW,
      fetchMessage,
    });
    const sending = writes.send(send(id));
    const error = failure(sending);
    await vi.advanceTimersByTimeAsync(0);
    device.settle({
      transactionId: '4',
      status: 'permanently-failed',
      errorCode: 'MUTATION_RETRY_EXHAUSTED',
      error: 'stopped after 3 server failures',
    });
    // Three questions of 15 s each, 500 ms and 1 s apart, each cancelled.
    await vi.advanceTimersByTimeAsync(46_500);
    expect(thrownResultErrorHasCode(await error, 'DELIVERY_UNKNOWN')).toBe(
      true
    );
    expect(
      fetchMessage.mock.calls.map(([, , signal]) => signal.aborted)
    ).toEqual([true, true, true]);
  });

  it('calls a send the queue stopped retrying unknown when the server cannot say', async () => {
    const id = graphqlMessage(7).id;
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const device = writeHost();
    const lookups: string[] = [];
    const writes = createChannelWrites({
      host: device.host,
      runtime: { notifyChanged: vi.fn() },
      client: () => client,
      now: () => NOW,
      fetchMessage: (_channelId, messageId) => {
        lookups.push(messageId);
        return Promise.reject(new Error('offline'));
      },
    });
    const sending = writes.send(send(id));
    await settleMicrotasks();
    device.settle({
      transactionId: '4',
      status: 'permanently-failed',
      errorCode: 'MUTATION_RETRY_EXHAUSTED',
      error: 'stopped after 3 server failures',
    });
    const error = await sending.catch((thrown: unknown) => thrown);
    // The composer sends a restored draft again under this id only then.
    expect(thrownResultErrorHasCode(error, 'DELIVERY_UNKNOWN')).toBe(true);
    expect(lookups).toEqual([id, id, id]);
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

  it('calls a send the queue rolled back while this page was away unknown', async () => {
    const { writes, queued, restore } = setup(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    queued.push('4');
    const sending = writes.send(send(graphqlMessage(7).id));
    await settleMicrotasks();
    queued.length = 0;
    restore();

    const error = await sending.catch((thrown: unknown) => thrown);
    // The request may still commit: only the same id is safe to send again.
    expect(thrownResultErrorHasCode(error, 'DELIVERY_UNKNOWN')).toBe(true);
  });

  describe('a write that left the queue while the page was away', () => {
    const away = async (
      stored: ReturnType<typeof graphqlMessage>,
      write: (writes: ReturnType<typeof setup>['writes']) => Promise<unknown>
    ) => {
      const world = setup(
        () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
        [stored]
      );
      world.queued.push('4');
      const writing = write(world.writes);
      await settleMicrotasks();
      world.queued.length = 0;
      world.restore();
      return writing.catch((thrown: unknown) => thrown);
    };
    const remove =
      (id: string) => (writes: ReturnType<typeof setup>['writes']) =>
        writes.remove({ channelId: CHANNEL_ID, id, nonce: 'd' });
    const edit = (id: string) => (writes: ReturnType<typeof setup>['writes']) =>
      writes.edit({
        channelId: CHANNEL_ID,
        id,
        content: 'edited',
        mentions: [],
        removeAttachmentIds: [],
        addAttachments: [],
        nonce: 'e',
      });
    const react =
      (id: string) => (writes: ReturnType<typeof setup>['writes']) =>
        writes.react({
          channelId: CHANNEL_ID,
          id,
          emoji: '👍',
          add: true,
          userId: SENDER,
          nonce: 'r',
        });
    const rolledBack = (outcome: unknown) =>
      thrownResultErrorHasCode(outcome, 'NOT_APPLIED');

    it('rejects a delete another tab rolled back', async () => {
      const stored = graphqlMessage(7);
      expect(rolledBack(await away(stored, remove(stored.id)))).toBe(true);
    });

    it('resolves a delete the device shows', async () => {
      const stored = graphqlMessage(7, { deletedAt: NOW.toISOString() });
      expect(await away(stored, remove(stored.id))).toEqual(
        mapChannelMessage(stored)
      );
    });

    it('rejects an edit another tab rolled back', async () => {
      const stored = graphqlMessage(7);
      expect(rolledBack(await away(stored, edit(stored.id)))).toBe(true);
    });

    it('resolves an edit the device shows', async () => {
      const stored = graphqlMessage(7, { content: 'edited' });
      expect(await away(stored, edit(stored.id))).toEqual(
        mapChannelMessage(stored)
      );
    });

    const editAttachments =
      (
        id: string,
        change: {
          removeAttachmentIds?: string[];
          addAttachments?: { entity_type: string; entity_id: string }[];
        }
      ) =>
      (writes: ReturnType<typeof setup>['writes']) =>
        writes.edit({
          channelId: CHANNEL_ID,
          id,
          content: 'edited',
          mentions: [],
          removeAttachmentIds: change.removeAttachmentIds ?? [],
          addAttachments: change.addAttachments ?? [],
          nonce: 'e',
        });
    const attachment = (attachmentId: string, entityId: string) => ({
      attachmentId,
      entityType: 'document',
      entityId,
      width: null,
      height: null,
      createdAt: NOW.toISOString(),
    });

    it('rejects an edit whose added attachment another tab rolled back', async () => {
      // The text matches: only the attachment tells the edit was undone.
      const stored = graphqlMessage(7, { content: 'edited' });
      const added = editAttachments(stored.id, {
        addAttachments: [{ entity_type: 'document', entity_id: 'doc-1' }],
      });
      expect(rolledBack(await away(stored, added))).toBe(true);
    });

    it('rejects an edit whose removed attachment the device still shows', async () => {
      const stored = graphqlMessage(7, {
        content: 'edited',
        attachments: [attachment('att-1', 'doc-1')],
      });
      const removed = editAttachments(stored.id, {
        removeAttachmentIds: ['att-1'],
      });
      expect(rolledBack(await away(stored, removed))).toBe(true);
    });

    it('resolves an edit whose attachment changes the device shows', async () => {
      const stored = graphqlMessage(7, {
        content: 'edited',
        attachments: [attachment('att-2', 'doc-2')],
      });
      const changed = editAttachments(stored.id, {
        removeAttachmentIds: ['att-1'],
        addAttachments: [{ entity_type: 'document', entity_id: 'doc-2' }],
      });
      expect(await away(stored, changed)).toEqual(mapChannelMessage(stored));
    });

    it('rejects a reaction another tab rolled back', async () => {
      const stored = graphqlMessage(7);
      expect(rolledBack(await away(stored, react(stored.id)))).toBe(true);
    });

    it('resolves a reaction the device shows', async () => {
      const stored = graphqlMessage(7, {
        reactions: [{ emoji: '👍', users: [SENDER] }],
      });
      expect(await away(stored, react(stored.id))).toEqual(
        mapChannelMessage(stored)
      );
    });
  });

  // Transaction ids restart when the device's queue is rebuilt.
  it('ignores a settlement for another mutation under its transaction id', async () => {
    const stored = graphqlMessage(7);
    const { writes, settle, calls } = setup(
      () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
      [stored]
    );
    const sending = writes.send(send(stored.id));
    await settleMicrotasks();
    settle({
      transactionId: '4',
      mutationUuid: crypto.randomUUID(),
      status: 'committed',
    });
    await settleMicrotasks();
    expect(writes.pendingCount(CHANNEL_ID)).toBe(1);

    settle({
      transactionId: '4',
      mutationUuid: calls[0].context.uuid,
      status: 'committed',
    });
    await expect(sending).resolves.toEqual(mapChannelMessage(stored));
  });

  it('does not take a rebuilt queue entry under its transaction id for itself', async () => {
    const { writes, queued, restore, fetched } = setup(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const id = graphqlMessage(7).id;
    const sending = writes.send(send(id));
    await settleMicrotasks();
    queued.push({ transactionId: '4', uuid: crypto.randomUUID() });
    restore();
    const error = await sending.catch((thrown: unknown) => thrown);
    // The request may still commit: only the same id is safe to send again.
    expect(thrownResultErrorHasCode(error, 'DELIVERY_UNKNOWN')).toBe(true);
    expect(fetched).toEqual([id, id, id]);
  });

  it('asks the queue again when it cannot answer after the page comes back', async () => {
    vi.useFakeTimers();
    try {
      const stored = graphqlMessage(7);
      const { writes, queued, queue, restore } = setup(
        () => ({ disposition: { kind: 'queued', transactionId: '4' } }),
        [stored]
      );
      queued.push('4');
      const sending = writes.send(send(stored.id));
      await vi.advanceTimersByTimeAsync(0);
      // Delivered from another tab while away; the first read fails.
      queued.length = 0;
      queue.failures = 1;
      restore();
      await vi.advanceTimersByTimeAsync(0);
      expect(writes.pendingCount(CHANNEL_ID)).toBe(1);

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(sending).resolves.toEqual(mapChannelMessage(stored));
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not call a send lost when the server cannot say whether it has it', async () => {
    const id = graphqlMessage(7).id;
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const device = writeHost();
    device.queued.push('4');
    const writes = createChannelWrites({
      host: device.host,
      runtime: { notifyChanged: vi.fn() },
      client: () => client,
      now: () => NOW,
      fetchMessage: () => Promise.reject(new Error('offline')),
    });
    const sending = writes.send(send(id));
    await settleMicrotasks();
    device.queued.length = 0;
    device.restore();
    const error = await sending.catch((thrown: unknown) => thrown);
    expect(thrownResultErrorHasCode(error, 'DELIVERY_UNKNOWN')).toBe(true);
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
      userId: SENDER,
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
