import type { MutationInspection } from '@graphql-cache/protocol';
import type { ChannelMessageFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapChannelMessage } from '../map';
import { readDeviceChannelPage } from '../pages';
import {
  channelHasQueuedReplies,
  forgetOwnReply,
  noteOwnReply,
  ownReplyDelivered,
  resetUnsettledReplies,
} from '../unsettled-replies';
import {
  CHANNEL_ID,
  devicePage,
  fakeHost,
  graphqlMessage,
  keyOf,
} from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
  getGraphqlSoupCacheHost: vi.fn(),
  graphqlCacheEnabled: vi.fn(),
}));

const queuedSend = (
  reply: ChannelMessageFieldsFragment,
  overrides: Partial<MutationInspection> = {}
) =>
  ({
    transactionId: `tx-${reply.id}`,
    uuid: reply.id,
    superseded: false,
    operationName: 'SendChannelMessage',
    variables: {
      input: {
        channelId: reply.channelId,
        id: reply.id,
        threadId: reply.threadId,
      },
    },
    ...overrides,
  }) as MutationInspection;

/** The page of one root as the device reads it, with these records held. */
async function readRoot(
  root: ChannelMessageFieldsFragment,
  held: ChannelMessageFieldsFragment[],
  queued: MutationInspection[] = []
) {
  const host = {
    ...fakeHost([devicePage([keyOf(root)])], { records: [root, ...held] }),
    inspectMutations: async () => queued,
  };
  const read = await readDeviceChannelPage(host, {
    channelId: CHANNEL_ID,
    limit: 50,
  });
  if (read.kind !== 'page') throw new Error(`device answered ${read.kind}`);
  const entry = read.page.entries[0];
  if (entry?.type !== 'message') throw new Error('no root on the page');
  return entry.message.thread;
}

describe('a device page and the replies its roots do not show yet', () => {
  beforeEach(() => {
    resetUnsettledReplies();
  });

  it('shows a reply another window left waiting in the device queue', async () => {
    const root = graphqlMessage(1);
    const reply = graphqlMessage(2, { threadId: root.id });

    const thread = await readRoot(root, [reply], [queuedSend(reply)]);

    expect(thread.reply_count).toBe(1);
    expect(thread.preview.map((shown) => shown.id)).toEqual([reply.id]);
    expect(thread.latest_reply_at).toBe(reply.createdAt);
  });

  it('leaves a root alone when nothing waits for it', async () => {
    const root = graphqlMessage(1);
    const other = graphqlMessage(3);
    const reply = graphqlMessage(2, { threadId: other.id });

    const thread = await readRoot(root, [reply], [queuedSend(reply)]);

    expect(thread).toEqual({
      reply_count: 0,
      latest_reply_at: null,
      preview: [],
    });
  });

  it('ignores queued writes that are not a reply to this channel', async () => {
    const root = graphqlMessage(1);
    const reply = graphqlMessage(2, { threadId: root.id });
    const elsewhere = { ...reply, channelId: 'another-channel' };

    const thread = await readRoot(
      root,
      [reply],
      [
        queuedSend(elsewhere),
        queuedSend(reply, { superseded: true }),
        queuedSend(reply, { operationName: 'EditChannelMessage' }),
      ]
    );

    expect(thread.reply_count).toBe(0);
  });

  it('shows a reply this window sent before the queue has stored it', async () => {
    const root = graphqlMessage(1);
    const reply = graphqlMessage(2, { threadId: root.id });
    noteOwnReply(CHANNEL_ID, root.id, mapChannelMessage(reply));

    const thread = await readRoot(root, []);

    expect(thread.preview.map((shown) => shown.id)).toEqual([reply.id]);
  });

  it('keeps a delivered reply on a root the device has not brought up to date', async () => {
    const root = graphqlMessage(1);
    const reply = graphqlMessage(2, { threadId: root.id });
    noteOwnReply(CHANNEL_ID, root.id, mapChannelMessage(reply));
    ownReplyDelivered(mapChannelMessage(reply));

    const thread = await readRoot(root, [reply]);

    expect(thread.reply_count).toBe(1);
    expect(thread.preview.map((shown) => shown.id)).toEqual([reply.id]);
  });

  it('does not count a delivered reply twice once its root is up to date', async () => {
    const reply = graphqlMessage(2, { threadId: 'root' });
    // A long thread: the root counts the reply and its preview is cut short.
    const base = graphqlMessage(1);
    const root = graphqlMessage(1, {
      thread: base.thread && {
        ...base.thread,
        replyCount: 40,
        latestReplyAt: reply.createdAt,
        preview: [],
      },
    });
    const sent = { ...reply, threadId: root.id };
    noteOwnReply(CHANNEL_ID, root.id, mapChannelMessage(sent));
    ownReplyDelivered(mapChannelMessage(sent));

    const first = await readRoot(root, [sent]);
    // The note is dropped then, so an older copy of the root stays as it is.
    const second = await readRoot(base, [sent]);

    expect(first.reply_count).toBe(40);
    expect(second.reply_count).toBe(0);
  });

  it('shows the reply once when its root already previews it', async () => {
    const reply = graphqlMessage(2, { threadId: 'root' });
    const base = graphqlMessage(1);
    const sent = { ...reply, threadId: base.id };
    const root = graphqlMessage(1, {
      thread: base.thread && {
        ...base.thread,
        replyCount: 1,
        latestReplyAt: sent.createdAt,
        preview: [sent],
      },
    });

    const thread = await readRoot(root, [sent], [queuedSend(sent)]);

    expect(thread.reply_count).toBe(1);
    expect(thread.preview).toHaveLength(1);
  });

  it('drops a reply the queue refused', async () => {
    const root = graphqlMessage(1);
    const reply = graphqlMessage(2, { threadId: root.id });
    noteOwnReply(CHANNEL_ID, root.id, mapChannelMessage(reply));
    forgetOwnReply(reply.id);

    const thread = await readRoot(root, []);

    expect(thread.reply_count).toBe(0);
  });

  it('does not show a waiting reply that was deleted', async () => {
    const root = graphqlMessage(1);
    const reply = graphqlMessage(2, {
      threadId: root.id,
      deletedAt: '2026-11-01T10:00:09.000000Z',
    });

    const thread = await readRoot(root, [reply], [queuedSend(reply)]);

    expect(thread.reply_count).toBe(0);
  });

  it('orders several waiting replies as they were written', async () => {
    const root = graphqlMessage(1);
    const earlier = graphqlMessage(2, { threadId: root.id });
    const later = graphqlMessage(3, { threadId: root.id });

    const thread = await readRoot(
      root,
      [later, earlier],
      [queuedSend(later), queuedSend(earlier)]
    );

    expect(thread.preview.map((shown) => shown.id)).toEqual([
      earlier.id,
      later.id,
    ]);
    expect(thread.reply_count).toBe(2);
  });

  it('reads the page as it is when the queue cannot be listed', async () => {
    const root = graphqlMessage(1);
    const host = {
      ...fakeHost([devicePage([keyOf(root)])], { records: [root] }),
      inspectMutations: async () => {
        throw new Error('queue closed');
      },
    };

    const read = await readDeviceChannelPage(host, {
      channelId: CHANNEL_ID,
      limit: 50,
    });

    expect(read.kind).toBe('page');
  });
});

describe('channelHasQueuedReplies', () => {
  it('is true only while a reply to the channel waits', async () => {
    const root = graphqlMessage(1);
    const reply = graphqlMessage(2, { threadId: root.id });
    const host = (queued: MutationInspection[]) => ({
      ...fakeHost([]),
      inspectMutations: async () => queued,
    });

    expect(await channelHasQueuedReplies(host([]), CHANNEL_ID)).toBe(false);
    expect(
      await channelHasQueuedReplies(host([queuedSend(root)]), CHANNEL_ID)
    ).toBe(false);
    expect(
      await channelHasQueuedReplies(host([queuedSend(reply)]), CHANNEL_ID)
    ).toBe(true);
    expect(await channelHasQueuedReplies(fakeHost([]), CHANNEL_ID)).toBe(false);
  });
});
