/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type {
  MessageCursor,
  MessageListItem,
  MessageParent,
  MessageTimelinePage,
} from '@service-storage/messages';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  track: vi.fn(),
}));

let testQueryClient: QueryClient;
const observerDisposals: Array<() => void> = [];

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-storage/messages', () => ({
  entityMessagesClient: { list: mocks.list },
}));

vi.mock('@app/lib/analytics', () => ({
  analytics: {
    track: mocks.track,
  },
}));

vi.mock('../subscription', () => ({
  useMessageSubscription: () => {},
}));

import { channelKeys } from '../../channel/keys';
import { normalizeChannelMessageSender } from '../message-sender';
import {
  getMessageTimelineQueryKey,
  insertTopLevelMessageIntoMessageTimeline,
  isMissingMessageError,
  type MessageTimelineData,
  mergeCatchUpPage,
  messageTimelineQueryOptions,
  removeTopLevelMessageFromMessageTimeline,
} from '../timeline';

const parent: MessageParent = { type: 'channel', id: 'channel-1' };
const document: MessageParent = { type: 'document', id: 'document-1' };

function createMessage(
  id: string,
  createdAt: string,
  overrides: Partial<MessageListItem> = {}
): MessageListItem {
  return normalizeChannelMessageSender({
    id,
    parent,
    thread_id: null,
    sender_id: 'user-1',
    mentions: [],
    content: `Message ${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: undefined,
    edited_at: undefined,
    attachments: [],
    reactions: [],
    state: {
      root_id: id,
      user_id: 'user-1',
      resolved: false,
      anchor: null,
      created_at: createdAt,
      updated_at: createdAt,
    },
    thread: {
      preview: [],
      reply_count: 0,
      latest_reply_at: null,
    },
    ...overrides,
  });
}

const cursor = (id: string, createdAt: string): MessageCursor => ({
  id,
  created_at: createdAt,
});
const cachedNext = cursor('cached-next', '2026-09-10T12:00:00Z');

function seedLatestCache(
  items: MessageListItem[],
  extras?: {
    nextCursor?: MessageCursor | null;
    previousCursor?: MessageCursor | null;
    pageParam?: {
      next_cursor: MessageCursor | null;
      previous_cursor: MessageCursor | null;
    };
  }
) {
  const data: MessageTimelineData = {
    pages: [
      {
        items,
        next_cursor: extras?.nextCursor ?? cachedNext,
        previous_cursor: extras?.previousCursor ?? null,
      },
    ],
    pageParams: [extras?.pageParam ?? null],
  };
  testQueryClient.setQueryData(getMessageTimelineQueryKey(parent, null), data);
}

function fullPage(
  items: MessageListItem[] = [createMessage('full-1', '2026-09-10T14:00:00Z')]
) {
  return {
    items,
    next_cursor: null,
    previous_cursor: null,
  };
}

const fullSelection = {
  limit: 50,
  cursor: undefined,
  direction: 'older',
  around: null,
  include_deleted_threads: false,
};

function resultError(code: string) {
  return new ThrownResultError([{ code, message: code }]);
}

beforeEach(() => {
  testQueryClient = new QueryClient();
  mocks.list.mockReset();
  mocks.track.mockReset();
});

afterEach(() => {
  for (const dispose of observerDisposals.splice(0)) dispose();
  testQueryClient.clear();
});

function observeTimeline() {
  const observer = new InfiniteQueryObserver(testQueryClient, {
    ...messageTimelineQueryOptions(parent, null),
    // Solid Query disables structural sharing, so a fix relying on that option
    // would pass a core-only test but still lose messages in the application.
    structuralSharing: false,
  });
  observerDisposals.push(observer.subscribe(() => {}));
  return observer;
}

function deferPage() {
  let resolve!: (page: MessageTimelinePage) => void;
  const promise = new Promise<MessageTimelinePage>((done) => {
    resolve = done;
  });
  mocks.list.mockReturnValueOnce(promise);
  return resolve;
}

describe('live messages during infinite timeline pagination', () => {
  it('retains an incoming message when an older response completes and can keep paging', async () => {
    const cached = createMessage('cached', '2026-09-10T13:00:00Z');
    const incoming = createMessage('incoming', '2026-09-10T14:00:00Z');
    const older = createMessage('older', '2026-09-10T12:00:00Z');
    const oldest = createMessage('oldest', '2026-09-10T11:00:00Z');
    seedLatestCache([cached]);
    const observer = observeTimeline();
    const release = deferPage();
    const pending = observer.fetchNextPage();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    testQueryClient.setQueryData<MessageTimelineData>(
      getMessageTimelineQueryKey(parent, null),
      (data) => insertTopLevelMessageIntoMessageTimeline(data, incoming)
    );
    const next = cursor(older.id, older.created_at);
    release({ ...fullPage([older]), next_cursor: next });
    const result = await pending;

    expect(
      result.data?.pages.map((page) => page.items.map((item) => item.id))
    ).toEqual([['incoming', 'cached'], ['older']]);
    expect(result.data?.pageParams).toEqual([
      null,
      { next_cursor: cachedNext, previous_cursor: null },
    ]);
    expect(result.hasNextPage).toBe(true);
    mocks.list.mockResolvedValueOnce(fullPage([oldest]));
    const nextResult = await observer.fetchNextPage();
    expect(mocks.list).toHaveBeenLastCalledWith(parent, {
      ...fullSelection,
      limit: 100,
      cursor: next,
    });
    expect(
      nextResult.data?.pages.flatMap((page) =>
        page.items.map((item) => item.id)
      )
    ).toEqual(['incoming', 'cached', 'older', 'oldest']);
    expect(nextResult.data?.pages).toHaveLength(3);
    expect(nextResult.hasNextPage).toBe(false);
  });

  it('keeps edits, tombstones and removals without duplicating an overlapping page', async () => {
    const edited = createMessage('edited', '2026-09-10T13:00:00Z');
    const removed = createMessage('removed', '2026-09-10T12:30:00Z');
    const deleted = createMessage('tombstone', '2026-09-10T12:15:00Z');
    const older = createMessage('older', '2026-09-10T12:00:00Z');
    seedLatestCache([edited, removed, deleted]);
    const observer = observeTimeline();
    const release = deferPage();
    const pending = observer.fetchNextPage();
    testQueryClient.setQueryData<MessageTimelineData>(
      getMessageTimelineQueryKey(parent, null),
      (data) => {
        const retained = removeTopLevelMessageFromMessageTimeline(
          data,
          removed.id
        )!;
        return {
          ...retained,
          pages: retained.pages.map((page) => ({
            ...page,
            items: page.items.map((message) =>
              message.id === edited.id
                ? {
                    ...message,
                    content: 'Live edit',
                    edited_at: '2026-09-10T14:00:00Z',
                  }
                : { ...message, deleted_at: '2026-09-10T14:00:00Z' }
            ),
          })),
        };
      }
    );
    release(fullPage([edited, removed, deleted, older, older]));
    const result = await pending;
    const items = result.data?.pages.flatMap((page) => page.items);

    expect(items?.map((item) => item.id)).toEqual([
      'edited',
      'tombstone',
      'older',
    ]);
    expect(items?.[0]).toMatchObject({
      content: 'Live edit',
      edited_at: '2026-09-10T14:00:00Z',
    });
    expect(items?.[1].deleted_at).toBe('2026-09-10T14:00:00Z');
    expect(result.data?.pages[1].next_cursor).toBeNull();
    expect(result.data?.pageParams).toHaveLength(2);
  });

  it('keeps live changes in the cached slice while fetching a newer page', async () => {
    const cached = createMessage('cached', '2026-09-10T13:00:00Z');
    const newer = createMessage('newer', '2026-09-10T14:00:00Z');
    const previous = cursor('newer-boundary', '2026-09-10T13:30:00Z');
    const initialParam = { next_cursor: cachedNext, previous_cursor: null };
    seedLatestCache([cached], {
      previousCursor: previous,
      pageParam: initialParam,
    });
    const observer = observeTimeline();
    const release = deferPage();
    const pending = observer.fetchPreviousPage();
    testQueryClient.setQueryData<MessageTimelineData>(
      getMessageTimelineQueryKey(parent, null),
      (data) => ({
        ...data!,
        pages: data!.pages.map((page) => ({
          ...page,
          items: page.items.map((message) => ({
            ...message,
            content: 'Live edit',
          })),
        })),
      })
    );
    release(fullPage([newer]));
    const result = await pending;

    expect(
      result.data?.pages.map((page) => page.items.map((item) => item.id))
    ).toEqual([['newer'], ['cached']]);
    expect(result.data?.pages[1].items[0].content).toBe('Live edit');
    expect(result.data?.pageParams).toEqual([
      { next_cursor: null, previous_cursor: previous },
      initialParam,
    ]);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('does not attach an obsolete response after the cached pagination boundary changed', async () => {
    seedLatestCache([createMessage('original', '2026-09-10T13:00:00Z')]);
    const observer = observeTimeline();
    const release = deferPage();
    const pending = observer.fetchNextPage();
    const replacementNext = cursor(
      'replacement-cursor',
      '2026-09-10T14:00:00Z'
    );
    seedLatestCache([createMessage('replacement', '2026-09-10T15:00:00Z')], {
      nextCursor: replacementNext,
    });
    release(fullPage([createMessage('obsolete-page', '2026-09-10T12:00:00Z')]));
    const result = await pending;

    expect(result.data?.pages).toHaveLength(1);
    expect(result.data?.pageParams).toEqual([null]);
    expect(result.data?.pages[0].items[0].id).toBe('replacement');
    expect(result.data?.pages[0].next_cursor).toEqual(replacementNext);
  });
});

describe('messageTimelineQueryOptions', () => {
  it.each(['NOT_FOUND', 'GONE'] as const)(
    'throws missing load-around messages without retrying them for %s',
    async (code) => {
      mocks.list.mockRejectedValueOnce(resultError(code));

      const options = messageTimelineQueryOptions(parent, 'message-missing');

      let error: unknown;
      try {
        await options.queryFn({ pageParam: null });
      } catch (err) {
        error = err;
      }

      if (!(error instanceof Error)) {
        throw new Error('Expected queryFn to throw an Error');
      }

      expect(error).toBeInstanceOf(ThrownResultError);
      expect(isMissingMessageError(error)).toBe(true);
      expect(options.retry(0, error)).toBe(false);
      expect(mocks.list).toHaveBeenCalledTimes(1);
      expect(mocks.list).toHaveBeenCalledWith(parent, {
        ...fullSelection,
        around: 'message-missing',
      });
    }
  );

  it('preserves the default single retry for other errors', () => {
    const options = messageTimelineQueryOptions(parent, null);

    expect(options.retry(0, new Error('network'))).toBe(true);
    expect(options.retry(1, new Error('network'))).toBe(false);
  });

  it('first load without cache uses the full timeline', async () => {
    const page = fullPage();
    mocks.list.mockResolvedValueOnce(page);

    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith(parent, fullSelection);
    expect(result.items.map((item) => item.id)).toEqual(['full-1']);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'no_cache',
    });
  });

  it('document timelines include whole-thread tombstones and report nothing', async () => {
    mocks.list.mockResolvedValueOnce(fullPage());

    await messageTimelineQueryOptions(document, null).queryFn({
      pageParam: null,
    });

    expect(mocks.list).toHaveBeenCalledWith(document, {
      ...fullSelection,
      include_deleted_threads: true,
    });
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('cache at latest fetches only roots newer than the newest cached root', async () => {
    const older = createMessage('msg-older', '2026-09-10T13:19:00.123456Z');
    const newer = createMessage('msg-newer', '2026-09-10T13:19:00.123457Z');
    seedLatestCache([older, newer]);
    const deltaItem = createMessage('msg-delta', '2026-09-10T13:20:00.000000Z');
    mocks.list.mockResolvedValueOnce({
      items: [deltaItem],
      next_cursor: cursor('msg-delta', '2026-09-10T13:20:00.000000Z'),
      previous_cursor: null,
    });

    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith(parent, {
      cursor: { created_at: '2026-09-10T13:19:00.123457Z', id: 'msg-newer' },
      direction: 'newer',
      limit: 50,
      include_deleted_threads: false,
    });
    expect(result.items.map((item) => item.id)).toEqual([
      'msg-delta',
      'msg-newer',
      'msg-older',
    ]);
    expect(result.next_cursor).toEqual(cachedNext);
    expect(result.previous_cursor).toBeNull();
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'catch_up',
      reason: 'watermark',
      after: '2026-09-10T13:19:00.123457Z',
    });
  });

  it('breaks created_at ties with the larger root id', async () => {
    const time = '2026-09-10T13:19:00.000000Z';
    seedLatestCache([
      createMessage('msg-a', time),
      createMessage('msg-b', time),
    ]);
    mocks.list.mockResolvedValueOnce({
      items: [],
      next_cursor: null,
      previous_cursor: null,
    });

    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(mocks.list).toHaveBeenCalledWith(
      parent,
      expect.objectContaining({ cursor: { created_at: time, id: 'msg-b' } })
    );
  });

  it('delta overflow falls back to the full timeline', async () => {
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00.123456Z')]);
    mocks.list.mockResolvedValueOnce({
      items: Array.from({ length: 50 }, (_, i) =>
        createMessage(`delta-${i}`, '2026-09-10T13:20:00Z')
      ),
      next_cursor: cursor('delta-49', '2026-09-10T13:20:00Z'),
      previous_cursor: cursor('delta-0', '2026-09-10T13:20:00Z'),
    });
    const page = fullPage();
    mocks.list.mockResolvedValueOnce(page);

    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(mocks.list).toHaveBeenLastCalledWith(parent, fullSelection);
    expect(result.items.map((item) => item.id)).toEqual(['full-1']);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'delta_overflow',
      after: '2026-09-10T13:19:00.123456Z',
    });
  });

  it('cache away from latest uses the full timeline', async () => {
    const page = fullPage();
    mocks.list.mockResolvedValue(page);

    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00Z')], {
      pageParam: {
        next_cursor: cursor('older', '2026-09-10T13:00:00Z'),
        previous_cursor: null,
      },
    });
    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });
    expect(mocks.list).toHaveBeenCalledWith(parent, fullSelection);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'cache_not_at_latest',
    });

    mocks.track.mockClear();
    mocks.list.mockClear();
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00Z')], {
      previousCursor: cursor('newer', '2026-09-10T13:30:00Z'),
    });
    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith(parent, fullSelection);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'cache_not_at_latest',
    });
  });

  it('load-around stays on the full timeline', async () => {
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00Z')]);
    mocks.list.mockResolvedValueOnce(fullPage());

    await messageTimelineQueryOptions(parent, 'message-42').queryFn({
      pageParam: null,
    });

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith(parent, {
      ...fullSelection,
      around: 'message-42',
    });
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'load_around',
    });
  });

  it('catch-up failure falls back except on auth errors', async () => {
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00.123456Z')]);
    mocks.list.mockRejectedValueOnce(resultError('INTERNAL'));
    mocks.list.mockResolvedValueOnce(fullPage());

    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(result.items.map((item) => item.id)).toEqual(['full-1']);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'catch_up_error',
      after: '2026-09-10T13:19:00.123456Z',
    });

    mocks.list.mockClear();
    mocks.track.mockClear();
    mocks.list.mockRejectedValueOnce(resultError('UNAUTHORIZED'));

    await expect(
      messageTimelineQueryOptions(parent, null).queryFn({
        pageParam: null,
      })
    ).rejects.toBeInstanceOf(ThrownResultError);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('list ahead sets the reason', async () => {
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00.123456Z')]);
    testQueryClient.setQueryData(channelKeys.listChannels.queryKey, [
      {
        id: 'channel-1',
        latest_non_thread_message: {
          message_id: 'msg-from-list',
          created_at: '2026-09-10T14:00:00Z',
          content: 'ahead',
          mentions: [],
          sender_id: 'user-1',
          updated_at: '2026-09-10T14:00:00Z',
        },
      },
    ] as unknown as ApiChannelWithLatest[]);
    mocks.list.mockResolvedValueOnce({
      items: [createMessage('msg-delta', '2026-09-10T13:20:00Z')],
      next_cursor: null,
      previous_cursor: null,
    });

    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'catch_up',
      reason: 'list_ahead',
      after: '2026-09-10T13:19:00.123456Z',
    });
  });

  it('catch-up merge uses the live first page, not the pre-request snapshot', async () => {
    const cached = createMessage('msg-1', '2026-09-10T13:19:00.123456Z');
    seedLatestCache([cached]);
    let releaseCatchUp!: () => void;
    const holdCatchUp = new Promise<void>((resolve) => {
      releaseCatchUp = resolve;
    });
    mocks.list.mockImplementationOnce(async () => {
      await holdCatchUp;
      return {
        items: [createMessage('msg-delta', '2026-09-10T13:20:00.000000Z')],
        next_cursor: null,
        previous_cursor: null,
      };
    });

    const pending = messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });
    await Promise.resolve();
    seedLatestCache([
      createMessage('msg-live', '2026-09-10T13:21:00.000000Z', {
        content: 'from websocket',
      }),
      cached,
    ]);
    releaseCatchUp();

    const result = await pending;
    expect(result.items.map((item) => item.id)).toEqual([
      'msg-live',
      'msg-delta',
      'msg-1',
    ]);
    expect(result.items[0]?.content).toBe('from websocket');
  });

  it('later pages keep using the full timeline without an event', async () => {
    mocks.list.mockResolvedValueOnce(fullPage());
    const older = cursor('page-2', '2026-09-10T12:00:00Z');

    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: { next_cursor: older, previous_cursor: null },
    });

    expect(mocks.list).toHaveBeenCalledWith(parent, {
      limit: 100,
      cursor: older,
      direction: 'older',
      around: null,
      include_deleted_threads: false,
    });
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('newer pages page forward from the previous cursor', async () => {
    mocks.list.mockResolvedValueOnce(fullPage());
    const newer = cursor('page-0', '2026-09-10T15:00:00Z');

    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: { next_cursor: null, previous_cursor: newer },
    });

    expect(mocks.list).toHaveBeenCalledWith(parent, {
      limit: 100,
      cursor: newer,
      direction: 'newer',
      around: null,
      include_deleted_threads: false,
    });
  });
});

describe('mergeCatchUpPage', () => {
  it('merge drops duplicates by id', () => {
    const cached = createMessage('msg-1', '2026-09-10T13:19:00Z');
    const deltaDup = createMessage('msg-1', '2026-09-10T13:19:00Z', {
      content: 'from delta',
    });
    const deltaNew = createMessage('msg-2', '2026-09-10T13:20:00Z');
    const merged = mergeCatchUpPage(
      {
        items: [deltaNew, deltaDup],
        next_cursor: cursor('ignore-me', '2026-09-10T13:19:00Z'),
        previous_cursor: cursor('also-ignore', '2026-09-10T13:20:00Z'),
      },
      {
        items: [cached],
        next_cursor: cachedNext,
        previous_cursor: cursor('cached-prev', '2026-09-10T13:30:00Z'),
      }
    );

    expect(merged.items.map((item) => item.id)).toEqual(['msg-2', 'msg-1']);
    expect(merged.items[1]?.content).toBe('from delta');
    expect(merged.next_cursor).toEqual(cachedNext);
    expect(merged.previous_cursor).toBeNull();
  });

  it('keeps a newer live insert ahead of older delta rows', () => {
    const cached = createMessage('msg-1', '2026-09-10T13:19:00Z');
    const live = createMessage('msg-live', '2026-09-10T13:21:00Z');
    const delta = createMessage('msg-delta', '2026-09-10T13:20:00Z');
    const merged = mergeCatchUpPage(
      {
        items: [delta],
        next_cursor: null,
        previous_cursor: null,
      },
      {
        items: [live, cached],
        next_cursor: cachedNext,
        previous_cursor: null,
      }
    );

    expect(merged.items.map((item) => item.id)).toEqual([
      'msg-live',
      'msg-delta',
      'msg-1',
    ]);
  });
});
