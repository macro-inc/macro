/**
 * @vitest-environment jsdom
 */

import type { CacheHost } from '@graphql-cache/host/types';
import type { MessageEvent } from '@service-storage/generated/schemas/messageEvent';
import type { Message } from '@service-storage/messages';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchLatestChannelPage: vi.fn(),
  fetchChannelPage: vi.fn(),
  fetchChannelChanges: vi.fn(),
  readCachedLatestPage: vi.fn(),
  writeCachedLatestPage: vi.fn(),
  channelCacheHost: vi.fn(),
}));

let testQueryClient: QueryClient;

vi.mock('../../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));
vi.mock('../source', () => mocks);
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@service-connection/client', () => ({
  useEntitySubscription: (
    _entity: unknown,
    onChange: (entity: unknown) => void
  ) => {
    subscriptionChanged = onChange;
  },
}));

let subscriptionChanged: ((entity: unknown) => void) | undefined;

import { createRoot } from 'solid-js';
import { registerNonce } from '../../../nonce';
import { MessageNonceKeys } from '../../keys';
import { useMessageSubscription } from '../../subscription';
import { handleMessageEvent } from '../../sync';
import {
  getMessageTimelineQueryKey,
  type MessageTimelineData,
  messageTimelineQueryOptions,
  softInvalidateMessageTimeline,
} from '../../timeline';
import {
  channelSyncSeq,
  channelWriteResponseApplies,
  channelWriteStarted,
  reconcileFailedChannelWrite,
  resetChannelSync,
} from '../channel-sync';
import { entryToGraphql } from '../convert';
import { CHANNEL, ids, messageEntry, page, reply, root } from './fixtures';

const HOST = {} as CacheHost;
const LATEST_KEY = getMessageTimelineQueryKey(CHANNEL, null);

function loadedIds() {
  return ids(testQueryClient.getQueryData<MessageTimelineData>(LATEST_KEY));
}

function loadedRoot(id: string) {
  const data = testQueryClient.getQueryData<MessageTimelineData>(LATEST_KEY);
  for (const loaded of data?.pages ?? []) {
    for (const entry of loaded.entries) {
      if (entry.type !== 'activity' && entry.message.id === id) {
        return entry.message;
      }
    }
  }
}

function event(
  seq: number | undefined,
  change: MessageEvent['change'],
  nonce?: string
): MessageEvent {
  return {
    parent: CHANNEL,
    actor: 'macro|other@example.com',
    change,
    nonce,
    seq,
  };
}

function posted(message: Message): MessageEvent['change'] {
  return {
    type: 'posted',
    message,
    mentions: [],
    notification_policy: 'Default',
  };
}

/** The server's page at `seq`, read on a cache miss. */
async function openAt(seq: number) {
  mocks.readCachedLatestPage.mockResolvedValue(undefined);
  mocks.fetchLatestChannelPage.mockResolvedValue({
    seq,
    userId: 'user',
    page: page([messageEntry('m2', 2), messageEntry('m1', 1)]),
  });
  await testQueryClient.fetchInfiniteQuery({
    ...messageTimelineQueryOptions(CHANNEL, null),
    retry: false,
  });
}

function noChanges(seq: number) {
  return {
    reset: false,
    seq,
    hasMore: false,
    entries: [],
    replies: [],
    activities: [],
    removed: [],
  };
}

beforeEach(() => {
  testQueryClient = new QueryClient();
  resetChannelSync();
  subscriptionChanged = undefined;
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.writeCachedLatestPage.mockResolvedValue(undefined);
  mocks.channelCacheHost.mockReturnValue(HOST);
});

afterEach(() => {
  vi.useRealTimers();
  testQueryClient.clear();
});

describe('a pushed change on a channel that follows its sequence', () => {
  it('applies the next change and moves the sequence number', async () => {
    await openAt(7);
    handleMessageEvent(event(8, posted(root('m3', 3))));
    expect(loadedIds()).toEqual([['m3', 'm2', 'm1']]);
    expect(channelSyncSeq(CHANNEL.id)).toBe(8);
    expect(mocks.fetchChannelChanges).not.toHaveBeenCalled();
    expect(testQueryClient.getQueryState(LATEST_KEY)?.isInvalidated).toBe(
      false
    );
  });

  it('ignores a change the timeline already holds', async () => {
    await openAt(7);
    handleMessageEvent(
      event(7, {
        type: 'edited',
        message: root('m1', 1, { content: 'old' }),
        mentions: [],
        notification_policy: 'Default',
        previous_attachments: [],
      })
    );
    expect(loadedRoot('m1')?.content).toBe('root m1');
    expect(channelSyncSeq(CHANNEL.id)).toBe(7);
  });

  it('asks for the changes between when one was missed', async () => {
    await openAt(7);
    mocks.fetchChannelChanges.mockResolvedValue({
      ...noChanges(9),
      entries: [
        entryToGraphql(messageEntry('m3', 3)),
        entryToGraphql(messageEntry('m4', 4)),
      ],
    });
    handleMessageEvent(event(9, posted(root('m4', 4))));
    // The pushed row waits for the one before it.
    expect(loadedIds()).toEqual([['m2', 'm1']]);
    await vi.waitFor(() => expect(channelSyncSeq(CHANNEL.id)).toBe(9));
    expect(mocks.fetchChannelChanges).toHaveBeenCalledWith(CHANNEL.id, 7);
    expect(loadedIds()).toEqual([['m4', 'm3', 'm2', 'm1']]);
  });

  it("applies the sender's own change once", async () => {
    await openAt(7);
    registerNonce(MessageNonceKeys.MESSAGE, 'm3');
    // A row the mutation rolled back, or one older changes overwrote, comes
    // back with the echo; the number then describes rows the timeline holds.
    handleMessageEvent(event(8, posted(root('m3', 3)), 'm3'));
    expect(loadedIds()).toEqual([['m3', 'm2', 'm1']]);
    expect(channelSyncSeq(CHANNEL.id)).toBe(8);
    registerNonce(MessageNonceKeys.MESSAGE, 'm3');
    handleMessageEvent(event(8, posted(root('m3', 3)), 'm3'));
    expect(loadedIds()).toEqual([['m3', 'm2', 'm1']]);
  });

  it('reads the timeline again after a failed write', async () => {
    await openAt(7);
    reconcileFailedChannelWrite(CHANNEL);
    expect(testQueryClient.getQueryState(LATEST_KEY)?.isInvalidated).toBe(true);
    // The rolled-back rows are in doubt until that read lands.
    expect(channelSyncSeq(CHANNEL.id)).toBeUndefined();
  });

  it('asks for that read again when the next write cancelled it', async () => {
    await openAt(7);
    vi.useFakeTimers();
    mocks.fetchLatestChannelPage.mockReturnValueOnce(new Promise(() => {}));
    reconcileFailedChannelWrite(CHANNEL);
    // What an optimistic write does before it edits the pages.
    await testQueryClient.cancelQueries({ queryKey: LATEST_KEY });
    testQueryClient.setQueryData<MessageTimelineData>(
      LATEST_KEY,
      (data) => data && { ...data }
    );
    expect(testQueryClient.getQueryState(LATEST_KEY)?.isInvalidated).toBe(
      false
    );
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 9,
      userId: 'user',
      page: page([messageEntry('m2', 2), messageEntry('m1', 1)]),
    });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(testQueryClient.getQueryState(LATEST_KEY)?.isInvalidated).toBe(true);
  });

  it('keeps asking until the number is back, however often a write cancels the read', async () => {
    await openAt(7);
    vi.useFakeTimers();
    mocks.fetchLatestChannelPage.mockReturnValue(new Promise(() => {}));
    reconcileFailedChannelWrite(CHANNEL);
    for (let write = 0; write < 2; write += 1) {
      await testQueryClient.cancelQueries({ queryKey: LATEST_KEY });
      testQueryClient.setQueryData<MessageTimelineData>(
        LATEST_KEY,
        (data) => data && { ...data }
      );
      expect(testQueryClient.getQueryState(LATEST_KEY)?.isInvalidated).toBe(
        false
      );
      await vi.advanceTimersByTimeAsync(1_500);
      expect(testQueryClient.getQueryState(LATEST_KEY)?.isInvalidated).toBe(
        true
      );
    }
  });

  it('does not ask in a loop for a read the server failed', async () => {
    await openAt(7);
    vi.useFakeTimers();
    mocks.fetchLatestChannelPage.mockReset();
    mocks.fetchLatestChannelPage.mockRejectedValue(new TypeError('offline'));
    const unsubscribe = new InfiniteQueryObserver(testQueryClient, {
      ...messageTimelineQueryOptions(CHANNEL, null),
      retry: false,
    }).subscribe(() => {});
    reconcileFailedChannelWrite(CHANNEL);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.fetchLatestChannelPage).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("starts a read again that the sender's own change arrived during", async () => {
    await openAt(7);
    const unsubscribe = new InfiniteQueryObserver(testQueryClient, {
      ...messageTimelineQueryOptions(CHANNEL, null),
      retry: false,
    }).subscribe(() => {});
    mocks.fetchLatestChannelPage.mockReset();
    // The first read predates the write; the one started over holds it.
    mocks.fetchLatestChannelPage.mockReturnValueOnce(new Promise(() => {}));
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 9,
      userId: 'user',
      page: page([
        messageEntry('m3', 3),
        messageEntry('m2', 2),
        messageEntry('m1', 1),
      ]),
    });
    reconcileFailedChannelWrite(CHANNEL);
    await vi.waitFor(() =>
      expect(mocks.fetchLatestChannelPage).toHaveBeenCalledTimes(1)
    );
    registerNonce(MessageNonceKeys.MESSAGE, 'm3');
    handleMessageEvent(event(9, posted(root('m3', 3)), 'm3'));
    await vi.waitFor(() => expect(channelSyncSeq(CHANNEL.id)).toBe(9));
    expect(mocks.fetchLatestChannelPage).toHaveBeenCalledTimes(2);
    expect(loadedIds()).toEqual([['m3', 'm2', 'm1']]);
    unsubscribe();
  });

  it('does not put a late response under a number that has moved', async () => {
    await openAt(7);
    const write = {};
    channelWriteStarted(CHANNEL, write);
    expect(channelWriteResponseApplies(CHANNEL, write)).toBe(true);
    handleMessageEvent(event(8, posted(root('m3', 3))));
    expect(channelSyncSeq(CHANNEL.id)).toBe(8);
    expect(channelWriteResponseApplies(CHANNEL, write)).toBe(false);
  });

  it('reads the root from the server when a reply it does not hold is deleted', async () => {
    await openAt(7);
    mocks.fetchChannelChanges.mockResolvedValue({
      ...noChanges(8),
      entries: [
        entryToGraphql(
          messageEntry('m1', 1, {
            thread: { reply_count: 4, latest_reply_at: null, preview: [] },
          })
        ),
      ],
      removed: ['r9'],
    });
    handleMessageEvent(
      event(8, {
        type: 'message_deleted',
        message: { ...reply('r9', 'm1', 5), deleted_at: 'now' },
      })
    );
    await vi.waitFor(() => expect(channelSyncSeq(CHANNEL.id)).toBe(8));
    expect(loadedRoot('m1')?.thread.reply_count).toBe(4);
    expect(mocks.fetchLatestChannelPage).toHaveBeenCalledTimes(1);
  });

  it('reads a call row from the changes, not the page', async () => {
    await openAt(7);
    mocks.fetchChannelChanges.mockResolvedValue(noChanges(8));
    handleMessageEvent(
      event(8, { type: 'call_root_posted', message: root('c1', 3) })
    );
    await vi.waitFor(() => expect(channelSyncSeq(CHANNEL.id)).toBe(8));
    expect(mocks.fetchLatestChannelPage).toHaveBeenCalledTimes(1);
  });

  it('writes the page back after a pushed change', async () => {
    vi.useFakeTimers();
    await openAt(7);
    handleMessageEvent(event(8, posted(root('m3', 3))));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(mocks.writeCachedLatestPage).toHaveBeenCalledTimes(1);
    const [, channelId, written] = mocks.writeCachedLatestPage.mock.calls[0];
    expect(channelId).toBe(CHANNEL.id);
    expect(written.seq).toBe(8);
    expect(
      written.page.entries.map(
        (entry: { message: { id: string } }) => entry.message.id
      )
    ).toEqual(['m3', 'm2', 'm1']);
  });

  it('is never marked stale', async () => {
    await openAt(7);
    softInvalidateMessageTimeline(CHANNEL);
    expect(testQueryClient.getQueryState(LATEST_KEY)?.isInvalidated).toBe(
      false
    );
  });

  it('catches up instead of reading again when its subscription reopens', async () => {
    await openAt(7);
    mocks.fetchChannelChanges.mockResolvedValue({
      ...noChanges(8),
      entries: [entryToGraphql(messageEntry('m3', 3))],
    });
    createRoot(() => useMessageSubscription(() => CHANNEL));
    subscriptionChanged?.({ entity_type: 'channel', entity_id: CHANNEL.id });
    await vi.waitFor(() => expect(channelSyncSeq(CHANNEL.id)).toBe(8));
    expect(loadedIds()).toEqual([['m3', 'm2', 'm1']]);
    expect(mocks.fetchLatestChannelPage).toHaveBeenCalledTimes(1);
    expect(testQueryClient.getQueryState(LATEST_KEY)?.isInvalidated).toBe(
      false
    );
  });
});

describe('a pushed change on a channel read from REST', () => {
  it('applies as before and marks the timeline stale', async () => {
    mocks.channelCacheHost.mockReturnValue(undefined);
    testQueryClient.setQueryData<MessageTimelineData>(LATEST_KEY, {
      pages: [page([messageEntry('m1', 1)])],
      pageParams: [null],
    });
    handleMessageEvent(event(8, posted(root('m3', 3))));
    expect(loadedIds()).toEqual([['m3', 'm1']]);
    expect(channelSyncSeq(CHANNEL.id)).toBeUndefined();
    expect(testQueryClient.getQueryState(LATEST_KEY)?.isInvalidated).toBe(true);
  });
});
