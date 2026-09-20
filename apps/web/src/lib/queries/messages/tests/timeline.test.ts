/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import type {
  MessageCursor,
  MessageListItem,
  MessageParent,
  MessageTimelineEntry,
  MessageTimelinePage,
} from '@service-storage/messages';
import { QueryClient } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  track: vi.fn(),
}));

let testQueryClient: QueryClient;

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

import { messageMutationKey } from '../keys';
import { normalizeChannelMessageSender } from '../message-sender';
import {
  createMessageIndex,
  findTopLevelMessageSnapshotInMessageTimeline,
  getMessageTimelineQueryKey,
  insertTopLevelMessageIntoMessageTimeline,
  isMissingMessageError,
  type MessageTimelineData,
  mapMessageTimelineItems,
  mergeCatchUpPage,
  messageTimelineQueryOptions,
  removeTopLevelMessageFromMessageTimeline,
  replaceTopLevelMessageIdInMessageTimeline,
  restoreTopLevelMessageInMessageTimeline,
} from '../timeline';
import { timelineEntryKey, timelineMessages } from '../timeline-entries';

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
        entries: items.map((message) => ({
          type: 'message' as const,
          message,
        })),
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
    entries: items.map((message) => ({ type: 'message' as const, message })),
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
  include_activity: true,
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
  testQueryClient.clear();
});

describe('messageTimelineQueryOptions', () => {
  it('fills the cached window without dropping concurrent optimistic inserts', async () => {
    const old = createMessage('old', '2026-09-10T12:00:00Z');
    const boundary = cursor(old.id, old.created_at);
    const live = createMessage('optimistic', '2026-09-10T16:00:00Z');
    seedLatestCache([old], { nextCursor: boundary });
    const first = createMessage('new', '2026-09-10T15:00:00Z');
    const middle = createMessage('middle', '2026-09-10T14:00:00Z');
    mocks.list.mockImplementationOnce(async () => {
      seedLatestCache([live, old], { nextCursor: boundary });
      return {
        entries: [first].map((message) => ({
          type: 'message' as const,
          message,
        })),
        next_cursor: cursor(first.id, first.created_at),
        previous_cursor: null,
      };
    });
    mocks.list.mockResolvedValueOnce({
      entries: [middle, old].map((message) => ({
        type: 'message' as const,
        message,
      })),
      next_cursor: boundary,
      previous_cursor: null,
    });
    const fetched = await testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(parent, null),
      staleTime: 0,
    });
    const result = fetched.pages[0];
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(
      result.entries
        .flatMap((entry) => (entry.type === 'message' ? [entry.message] : []))
        .map((item) => item.id)
    ).toEqual(['optimistic', 'new', 'middle', 'old']);
    expect(result.next_cursor).toEqual(boundary);
  });

  it('keeps the message-only catch-up path available for discussions', async () => {
    const cached = createMessage('old', '2026-09-10T12:00:00Z', {
      parent: document,
    });
    testQueryClient.setQueryData(getMessageTimelineQueryKey(document, null), {
      pages: [fullPage([cached])],
      pageParams: [null],
    });
    const fresh = createMessage('new', '2026-09-10T14:00:00Z', {
      parent: document,
    });
    mocks.list.mockResolvedValueOnce(fullPage([fresh]));
    const result = await messageTimelineQueryOptions(document, null).queryFn({
      pageParam: null,
    });
    expect(mocks.list).toHaveBeenCalledWith(document, {
      cursor: cursor(cached.id, cached.created_at),
      direction: 'newer',
      limit: 50,
      include_deleted_threads: true,
    });
    expect(
      result.entries
        .flatMap((entry) => (entry.type === 'message' ? [entry.message] : []))
        .map((item) => item.id)
    ).toEqual(['new', 'old']);
  });
  it.each(['NOT_FOUND', 'GONE'] as const)(
    'does not retry a missing centered message (%s)',
    async (code) => {
      const error = resultError(code);
      mocks.list.mockRejectedValueOnce(error);
      const options = messageTimelineQueryOptions(parent, 'missing');
      await expect(options.queryFn({ pageParam: null })).rejects.toBe(error);
      expect(isMissingMessageError(error)).toBe(true);
      expect(options.retry(0, error)).toBe(false);
      expect(mocks.list).toHaveBeenCalledWith(parent, {
        ...fullSelection,
        around: 'missing',
      });
    }
  );

  it('loads messages and activity in one request', async () => {
    const activities = [
      {
        id: 'activity-1',
        actor_id: 'user-1',
        occurred_at: '2026-09-10T13:00:00Z',
        action: 'picture_changed',
      },
    ];
    mocks.list.mockResolvedValueOnce({
      ...fullPage(),
      entries: [
        ...fullPage().entries,
        ...activities.map((activity) => ({ type: 'activity', activity })),
      ],
    });
    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(parent, fullSelection);
    expect(result.entries.map((entry) => entry.type)).toEqual([
      'message',
      'activity',
    ]);
    expect(result.entries[1]).toEqual({
      type: 'activity',
      activity: activities[0],
    });
    expect(
      result.entries.flatMap((entry) =>
        entry.type === 'message' ? [entry.message] : []
      )[0].id
    ).toBe('full-1');
  });

  it('refreshes activity that materialized behind the newest cached message', async () => {
    const latest = createMessage('latest', '2026-09-10T14:00:00Z');
    seedLatestCache([latest]);
    const activity = {
      id: 'late-activity',
      actor_id: 'user-1',
      occurred_at: '2026-09-10T13:00:00Z',
      action: 'picture_changed',
    };
    mocks.list.mockResolvedValueOnce({
      ...fullPage([latest]),
      entries: [...fullPage([latest]).entries, { type: 'activity', activity }],
    });
    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(parent, fullSelection);
    expect(result.entries[1]).toEqual({ type: 'activity', activity });
  });

  it('keeps activity-only pages and their cursors', async () => {
    const next = cursor('activity-1', '2026-09-10T13:00:00Z');
    mocks.list.mockResolvedValueOnce({
      entries: [
        {
          type: 'activity',
          activity: {
            id: next.id,
            actor_id: 'user-1',
            occurred_at: next.created_at,
            action: 'picture_changed',
          },
        },
      ],
      next_cursor: next,
      previous_cursor: null,
    });
    const options = messageTimelineQueryOptions(parent, null);
    const result = await options.queryFn({ pageParam: null });
    expect(
      result.entries.flatMap((entry) =>
        entry.type === 'message' ? [entry.message] : []
      )
    ).toEqual([]);
    expect(options.getNextPageParam(result)).toEqual({
      next_cursor: next,
      previous_cursor: null,
    });
  });

  it.each(['older', 'newer'] as const)(
    'paginates mixed rows %s using the shared cursor',
    async (direction) => {
      const boundary = cursor('activity-1', '2026-09-10T13:00:00Z');
      mocks.list.mockResolvedValueOnce(fullPage());
      const params =
        direction === 'older'
          ? { next_cursor: boundary, previous_cursor: null }
          : { next_cursor: null, previous_cursor: boundary };
      await messageTimelineQueryOptions(parent, null).queryFn({
        pageParam: params,
      });
      expect(mocks.list).toHaveBeenCalledExactlyOnceWith(parent, {
        ...fullSelection,
        around: null,
        cursor: boundary,
        direction,
        limit: 100,
      });
    }
  );

  it('leaves document activity disabled and includes thread tombstones', async () => {
    mocks.list.mockResolvedValueOnce(fullPage());
    await messageTimelineQueryOptions(document, null).queryFn({
      pageParam: null,
    });
    expect(mocks.list).toHaveBeenCalledWith(document, {
      ...fullSelection,
      include_activity: false,
      include_deleted_threads: true,
    });
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('retains the bounded retry policy and propagates authorization failures', async () => {
    const error = resultError('FORBIDDEN');
    mocks.list.mockRejectedValueOnce(error);
    const options = messageTimelineQueryOptions(parent, null);
    await expect(options.queryFn({ pageParam: null })).rejects.toBe(error);
    expect(options.retry(0, error)).toBe(false);
    expect(options.retry(0, new Error('network'))).toBe(true);
    expect(options.retry(1, new Error('network'))).toBe(false);
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
        entries: [deltaNew, deltaDup].map((message) => ({
          type: 'message' as const,
          message,
        })),
        next_cursor: cursor('ignore-me', '2026-09-10T13:19:00Z'),
        previous_cursor: cursor('also-ignore', '2026-09-10T13:20:00Z'),
      },
      {
        entries: [cached].map((message) => ({
          type: 'message' as const,
          message,
        })),
        next_cursor: cachedNext,
        previous_cursor: cursor('cached-prev', '2026-09-10T13:30:00Z'),
      }
    );

    expect(
      merged.entries
        .flatMap((entry) => (entry.type === 'message' ? [entry.message] : []))
        .map((item) => item.id)
    ).toEqual(['msg-2', 'msg-1']);
    expect(
      merged.entries.flatMap((entry) =>
        entry.type === 'message' ? [entry.message] : []
      )[1]?.content
    ).toBe('from delta');
    expect(merged.next_cursor).toEqual(cachedNext);
    expect(merged.previous_cursor).toBeNull();
  });

  it('keeps a newer live insert ahead of older delta rows', () => {
    const cached = createMessage('msg-1', '2026-09-10T13:19:00Z');
    const live = createMessage('msg-live', '2026-09-10T13:21:00Z');
    const delta = createMessage('msg-delta', '2026-09-10T13:20:00Z');
    const merged = mergeCatchUpPage(
      {
        entries: [delta].map((message) => ({
          type: 'message' as const,
          message,
        })),
        next_cursor: null,
        previous_cursor: null,
      },
      {
        entries: [live, cached].map((message) => ({
          type: 'message' as const,
          message,
        })),
        next_cursor: cachedNext,
        previous_cursor: null,
      }
    );

    expect(
      merged.entries
        .flatMap((entry) => (entry.type === 'message' ? [entry.message] : []))
        .map((item) => item.id)
    ).toEqual(['msg-live', 'msg-delta', 'msg-1']);
  });
});

describe('unified timeline entries', () => {
  function mixedPage(): MessageTimelineData {
    return {
      pages: [
        {
          entries: [
            {
              type: 'activity',
              activity: {
                id: 'shared-id',
                actor_id: 'user-1',
                action: 'renamed',
                occurred_at: '2026-09-10T15:00:00Z',
              },
            },
            {
              type: 'message',
              message: createMessage('shared-id', '2026-09-10T14:00:00Z'),
            },
            {
              type: 'activity',
              activity: {
                id: 'older',
                actor_id: 'user-1',
                action: 'picture_changed',
                occurred_at: '2026-09-10T13:00:00Z',
              },
            },
          ],
          next_cursor: cachedNext,
          previous_cursor: null,
        },
      ],
      pageParams: [null],
    };
  }

  it('renders server entries oldest first with separate message and activity identities', () => {
    createRoot((dispose) => {
      const data = mixedPage();
      const index = createMessageIndex(() => data);
      expect(index.entries.map(timelineEntryKey)).toEqual([
        'activity:older',
        'shared-id',
        'activity:shared-id',
      ]);
      expect(index.keys).toEqual(['shared-id']);
      expect(index.byId.get('shared-id')?.content).toBe('Message shared-id');
      dispose();
    });
  });

  it('keeps activity in place through message removal and rollback', () => {
    const data = mixedPage();
    testQueryClient.setQueryData(getMessageTimelineQueryKey(parent), data);
    const snapshot = findTopLevelMessageSnapshotInMessageTimeline(
      parent,
      'shared-id'
    )!;
    expect(snapshot.message.id).toBe('shared-id');
    const removed = removeTopLevelMessageFromMessageTimeline(data, 'shared-id');
    expect(removed?.pages[0].entries.map(timelineEntryKey)).toEqual([
      'activity:shared-id',
      'activity:older',
    ]);
    const restored = restoreTopLevelMessageInMessageTimeline(removed, snapshot);
    expect(restored).toEqual(data);
  });

  it('places a delayed live message between system events without dropping either', () => {
    const inserted = insertTopLevelMessageIntoMessageTimeline(
      mixedPage(),
      createMessage('delayed', '2026-09-10T14:30:00Z')
    );
    expect(inserted?.pages[0].entries.map(timelineEntryKey)).toEqual([
      'activity:shared-id',
      'delayed',
      'shared-id',
      'activity:older',
    ]);
    expect(inserted?.pages[0].next_cursor).toEqual(cachedNext);
  });

  it('deduplicates overlapping server windows and keeps updated activity payloads', () => {
    const page = mixedPage().pages[0];
    const first = page.entries[0];
    if (first.type !== 'activity') throw new Error('expected activity');
    const updated = {
      ...first,
      activity: { ...first.activity, payload: { name: 'Updated name' } },
    };
    const merged = mergeCatchUpPage({ ...page, entries: [updated] }, page);
    expect(merged.entries).toEqual([updated, ...page.entries.slice(1)]);
  });
});

// Small pages keep each server boundary visible in the regression scenarios.
describe('authoritative mixed timeline refresh', () => {
  const at = (hour: number) =>
    `2026-09-10T${String(hour).padStart(2, '0')}:00:00Z`;
  const message = (hour: number) => createMessage(`message-${hour}`, at(hour));
  const position = (hour: number) => cursor(`message-${hour}`, at(hour));
  const page = (
    hours: number[],
    older: number | null,
    newer: number | null = null
  ): MessageTimelinePage => ({
    ...fullPage(hours.map(message)),
    next_cursor: older === null ? null : position(older),
    previous_cursor: newer === null ? null : position(newer),
  });
  const key = getMessageTimelineQueryKey(parent);
  function cache(pages: MessageTimelinePage[], around: string | null = null) {
    const data: MessageTimelineData = {
      pages,
      pageParams: pages.map((_, index) =>
        index === 0
          ? null
          : {
              next_cursor: pages[index - 1].next_cursor ?? null,
              previous_cursor: null,
            }
      ),
    };
    testQueryClient.setQueryData(
      getMessageTimelineQueryKey(parent, around),
      data
    );
    return data;
  }
  function pendingWrite(id: string, nested = false) {
    const mutation = testQueryClient
      .getMutationCache()
      .build(testQueryClient, { mutationKey: messageMutationKey });
    const target = { kind: 'top_level', messageId: id };
    mutation.state = {
      ...mutation.state,
      status: 'pending',
      variables: { parent },
      context: nested ? { insert: { target } } : { target },
    };
  }

  it('removes a missed server deletion instead of unioning stale cached roots back in', async () => {
    cache([page([18, 16, 14], 14)]);
    mocks.list.mockResolvedValueOnce(page([18, 14], 14));
    const result = await testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(parent, null),
      staleTime: 0,
    });
    expect(
      result.pages.flatMap(timelineMessages).map((entry) => entry.id)
    ).toEqual(['message-18', 'message-14']);
  });

  it('keeps edits and deletions received after the server snapshot', async () => {
    cache([page([18, 16, 14], 14)]);
    mocks.list.mockImplementationOnce(async () => {
      testQueryClient.setQueryData<MessageTimelineData>(
        key,
        (data) =>
          data &&
          mapMessageTimelineItems(
            removeTopLevelMessageFromMessageTimeline(data, 'message-16')!,
            (root) =>
              root.id === 'message-18'
                ? { ...root, content: 'Live edit' }
                : root
          )
      );
      return page([18, 16, 14], 14);
    });
    const result = await testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(parent, null),
      staleTime: 0,
    });
    expect(
      result.pages
        .flatMap(timelineMessages)
        .map((entry) => [entry.id, entry.content])
    ).toEqual([
      ['message-18', 'Live edit'],
      ['message-14', 'Message message-14'],
    ]);
  });

  it('preserves an already-pending optimistic post, edit, and deletion', async () => {
    const edited = { ...message(18), content: 'Pending edit' };
    const local = {
      ...page([20, 18, 14], 14),
      entries: fullPage([message(20), edited, message(14)]).entries,
    };
    cache([local]);
    pendingWrite('message-20', true);
    pendingWrite('message-18');
    pendingWrite('message-16');
    mocks.list.mockResolvedValueOnce(page([18, 16, 14], 14));
    const result = await testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(parent, null),
      staleTime: 0,
    });
    expect(
      result.pages
        .flatMap(timelineMessages)
        .map((entry) => [entry.id, entry.content])
    ).toEqual([
      ['message-20', 'Message message-20'],
      ['message-18', 'Pending edit'],
      ['message-14', 'Message message-14'],
    ]);
  });

  it('does not commit a duplicate when GET sees a posted root before its acknowledgement', async () => {
    const optimistic = createMessage('optimistic-root', at(20));
    cache([
      { ...page([], 14), entries: fullPage([optimistic, message(14)]).entries },
    ]);
    let acknowledge!: () => void;
    const acknowledgement = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const mutation = testQueryClient.getMutationCache().build(testQueryClient, {
      mutationKey: messageMutationKey,
      mutationFn: async (_variables: {
        parent: MessageParent;
        optimisticId: string;
        message: { content: string };
      }) => acknowledgement,
      onSuccess: () => {
        testQueryClient.setQueryData<MessageTimelineData>(
          key,
          (data) =>
            data &&
            replaceTopLevelMessageIdInMessageTimeline(
              data,
              'optimistic-root',
              'server-root'
            )
        );
      },
    });
    const posted = mutation.execute({
      parent,
      optimisticId: 'optimistic-root',
      message: { content: 'Posted' },
    });
    mocks.list.mockResolvedValueOnce({
      ...page([], 14),
      entries: fullPage([createMessage('server-root', at(20)), message(14)])
        .entries,
    });
    const fetched = testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(parent, null),
      staleTime: 0,
    });
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(testQueryClient.getQueryState(key)?.fetchStatus).toBe('fetching');
    expect(
      testQueryClient
        .getQueryData<MessageTimelineData>(key)
        ?.pages[0].entries.map(timelineEntryKey)
    ).toEqual(['optimistic-root', 'message-14']);
    acknowledge();
    await posted;
    const result = await fetched;
    expect(
      result.pages.flatMap(timelineMessages).map((entry) => entry.id)
    ).toEqual(['server-root', 'message-14']);
  });

  it('releases a pending acknowledgement wait when its query is cancelled', async () => {
    cache([page([20, 14], 14)]);
    let acknowledge!: () => void;
    const acknowledgement = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const mutation = testQueryClient.getMutationCache().build(testQueryClient, {
      mutationKey: messageMutationKey,
      mutationFn: async (_variables: {
        parent: MessageParent;
        optimisticId: string;
        message: { content: string };
      }) => acknowledgement,
    });
    const posted = mutation.execute({
      parent,
      optimisticId: 'optimistic-root',
      message: { content: 'Posted' },
    });
    mocks.list.mockResolvedValueOnce(page([20, 14], 14));
    const fetched = testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(parent, null),
      staleTime: 0,
    });
    await vi.waitFor(() =>
      expect(testQueryClient.getMutationCache().hasListeners()).toBe(true)
    );
    await testQueryClient.cancelQueries({ queryKey: key });
    expect(testQueryClient.getMutationCache().hasListeners()).toBe(false);
    expect(testQueryClient.getQueryState(key)?.fetchStatus).toBe('idle');
    await fetched;
    acknowledge();
    await posted;
  });

  it('retains historical bounds and changes received while a later page is loading', async () => {
    cache([page([20, 18], 18), page([16, 14], 14, 16)]);
    mocks.list.mockResolvedValueOnce(page([20, 18], 18));
    const activity: MessageTimelineEntry = {
      type: 'activity',
      activity: {
        id: 'late',
        actor_id: 'user',
        action: 'renamed',
        occurred_at: at(17),
      },
    };
    mocks.list.mockResolvedValueOnce({
      ...page([16], 16, 17),
      entries: [activity, ...page([16], 16).entries],
    });
    mocks.list.mockImplementationOnce(async () => {
      testQueryClient.setQueryData<MessageTimelineData>(
        key,
        (data) =>
          data &&
          mapMessageTimelineItems(data, (root) =>
            root.id === 'message-20'
              ? { ...root, content: 'Edited during history fetch' }
              : root
          )
      );
      return page([14], 14, 14);
    });
    const result = await testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(parent, null),
      staleTime: 0,
    });
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(result.pages[1].entries.map(timelineEntryKey)).toEqual([
      'activity:late',
      'message-16',
      'message-14',
    ]);
    expect(result.pages[1].next_cursor).toEqual(position(14));
    expect(timelineMessages(result.pages[0])[0].content).toBe(
      'Edited during history fetch'
    );
  });

  it('keeps both sides of a centered reading window when new activity reduces its first response', async () => {
    const around = 'message-16';
    cache([page([20, 16, 12], 12, 20)], around);
    mocks.list.mockResolvedValueOnce(page([18, 16, 14], 14, 18));
    mocks.list.mockResolvedValueOnce(page([12, 10], 10, 12));
    mocks.list.mockResolvedValueOnce(page([22, 20], 20, 22));
    const result = await testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(parent, around),
      staleTime: 0,
    });
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(
      result.pages.flatMap(timelineMessages).map((entry) => entry.id)
    ).toEqual([
      'message-20',
      'message-18',
      'message-16',
      'message-14',
      'message-12',
    ]);
    expect(result.pages[0].previous_cursor).toEqual(position(20));
    expect(result.pages[0].next_cursor).toEqual(position(12));
  });

  it('places delayed root posts in their loaded historical page and excludes unloaded history', () => {
    const data = cache([page([20, 18], 18), page([16, 14], 14, 16)]);
    const inserted = insertTopLevelMessageIntoMessageTimeline(
      data,
      message(15)
    )!;
    expect(inserted.pages[0].entries.map(timelineEntryKey)).toEqual([
      'message-20',
      'message-18',
    ]);
    expect(inserted.pages[1].entries.map(timelineEntryKey)).toEqual([
      'message-16',
      'message-15',
      'message-14',
    ]);
    expect(
      insertTopLevelMessageIntoMessageTimeline(inserted, message(13))
    ).toBe(inserted);
  });

  it('preserves fresh unrelated facts when a live thread update clones entry wrappers', async () => {
    cache([page([20, 18, 16], 16)]);
    mocks.list.mockImplementationOnce(async () => {
      testQueryClient.setQueryData<MessageTimelineData>(
        key,
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              entries: page.entries.map((entry) =>
                entry.type === 'message'
                  ? {
                      ...entry,
                      message:
                        entry.message.id === 'message-20'
                          ? {
                              ...entry.message,
                              state: { ...entry.message.state, resolved: true },
                            }
                          : entry.message,
                    }
                  : entry
              ),
            })),
          }
      );
      return page([20, 16], 16);
    });
    const result = await testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(parent, null),
      structuralSharing: false,
      staleTime: 0,
    });
    expect(
      result.pages.flatMap(timelineMessages).map((entry) => entry.id)
    ).toEqual(['message-20', 'message-16']);
    expect(timelineMessages(result.pages[0])[0].state.resolved).toBe(true);
  });

  it('rolls back into the correct page after newer pages were loaded', () => {
    const around = 'message-16';
    const data = cache([page([18, 16, 14], 14, 18)], around);
    const snapshot = findTopLevelMessageSnapshotInMessageTimeline(
      parent,
      'message-16'
    )!;
    const deleted = removeTopLevelMessageFromMessageTimeline(
      data,
      'message-16'
    )!;
    const withNewer: MessageTimelineData = {
      ...deleted,
      pages: [page([22, 20], 20), ...deleted.pages],
      pageParams: [{ next_cursor: null, previous_cursor: position(18) }, null],
    };
    const restored = restoreTopLevelMessageInMessageTimeline(
      withNewer,
      snapshot
    )!;
    expect(restored.pages[0].entries.map(timelineEntryKey)).toEqual([
      'message-22',
      'message-20',
    ]);
    expect(restored.pages[1].entries.map(timelineEntryKey)).toEqual([
      'message-18',
      'message-16',
      'message-14',
    ]);
  });

  it('reorders server timestamps and acknowledged IDs around activity rows', () => {
    const activity: MessageTimelineEntry = {
      type: 'activity',
      activity: {
        id: 'm',
        actor_id: 'user',
        action: 'renamed',
        occurred_at: at(18),
      },
    };
    const data = cache([
      {
        ...page([], null),
        entries: [
          { type: 'message', message: createMessage('z', at(18)) },
          activity,
          { type: 'message', message: message(16) },
        ],
      },
    ]);
    const acknowledged = replaceTopLevelMessageIdInMessageTimeline(
      data,
      'z',
      'a'
    )!;
    expect(acknowledged.pages[0].entries.map(timelineEntryKey)).toEqual([
      'activity:m',
      'a',
      'message-16',
    ]);
    const committed = mapMessageTimelineItems(acknowledged, (root) =>
      root.id === 'a' ? { ...root, created_at: at(15) } : root
    );
    expect(committed.pages[0].entries.map(timelineEntryKey)).toEqual([
      'activity:m',
      'message-16',
      'a',
    ]);
  });

  it('repositions an acknowledgement across page boundaries when client and server clocks differ', () => {
    const data = cache([page([20, 18], 18), page([16, 14], 14, 16)]);
    const committed = mapMessageTimelineItems(data, (root) =>
      root.id === 'message-20' ? { ...root, created_at: at(15) } : root
    );
    expect(committed.pages[0].entries.map(timelineEntryKey)).toEqual([
      'message-18',
    ]);
    expect(committed.pages[1].entries.map(timelineEntryKey)).toEqual([
      'message-16',
      'message-20',
      'message-14',
    ]);
  });

  it('preserves centered history after pagination toward newer messages changed the first page parameter', async () => {
    const around = 'message-16';
    const data: MessageTimelineData = {
      pages: [
        page([22, 20], 20),
        page([18, 16, 14], 14, 18),
        page([12, 10], 10, 12),
      ],
      pageParams: [
        { next_cursor: null, previous_cursor: position(18) },
        null,
        { next_cursor: position(14), previous_cursor: null },
      ],
    };
    testQueryClient.setQueryData(
      getMessageTimelineQueryKey(parent, around),
      data
    );
    mocks.list.mockResolvedValueOnce(page([22, 20], 20));
    mocks.list.mockResolvedValueOnce(page([19, 18, 16], 16, 19));
    mocks.list.mockResolvedValueOnce(page([14, 12], 12, 14));
    mocks.list.mockResolvedValueOnce(page([12, 10], 10, 12));
    const result = await testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(parent, around),
      staleTime: 0,
    });
    expect(mocks.list).toHaveBeenCalledTimes(4);
    expect(
      result.pages.map((page) => page.entries.map(timelineEntryKey))
    ).toEqual([
      ['message-22', 'message-20'],
      ['message-19', 'message-18', 'message-16', 'message-14'],
      ['message-12', 'message-10'],
    ]);
  });

  it('rolls a deletion back chronologically after concurrent inserts', () => {
    const data = cache([page([18, 16, 14], null)]);
    const snapshot = findTopLevelMessageSnapshotInMessageTimeline(
      parent,
      'message-16'
    )!;
    const deleted = removeTopLevelMessageFromMessageTimeline(
      data,
      'message-16'
    )!;
    const inserted = insertTopLevelMessageIntoMessageTimeline(
      deleted,
      message(20)
    )!;
    const restored = restoreTopLevelMessageInMessageTimeline(
      inserted,
      snapshot
    )!;
    expect(restored.pages[0].entries.map(timelineEntryKey)).toEqual([
      'message-20',
      'message-18',
      'message-16',
      'message-14',
    ]);
  });
});
