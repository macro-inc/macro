/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type {
  MessageCursor,
  MessageListItem,
  MessageParent,
  MessageTimelineEntry,
  TimelineActivity,
} from '@service-storage/messages';
import { QueryClient } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  timeline: vi.fn(),
  track: vi.fn(),
}));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-storage/messages', () => ({
  entityMessagesClient: { timeline: mocks.timeline },
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
  createMessageIndex,
  findTopLevelMessageSnapshotInMessageTimeline,
  getMessageTimelineQueryKey,
  insertActivitiesIntoMessageTimeline,
  isMissingMessageError,
  type MessageTimelineData,
  mergeCatchUpPage,
  messageTimelineQueryOptions,
  removeTopLevelMessageFromMessageTimeline,
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

const entries = (items: MessageListItem[]): MessageTimelineEntry[] =>
  items.map((message) => ({ type: 'message', message }));
const ids = (page: { entries: MessageTimelineEntry[] }) =>
  timelineMessages(page).map((item) => item.id);

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
        entries: entries(items),
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
    entries: entries(items),
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
  mocks.timeline.mockReset();
  mocks.track.mockReset();
});

afterEach(() => {
  testQueryClient.clear();
});

describe('messageTimelineQueryOptions', () => {
  it.each(['NOT_FOUND', 'GONE'] as const)(
    'throws missing load-around messages without retrying them for %s',
    async (code) => {
      mocks.timeline.mockRejectedValueOnce(resultError(code));

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
      expect(mocks.timeline).toHaveBeenCalledTimes(1);
      expect(mocks.timeline).toHaveBeenCalledWith(parent, {
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
    mocks.timeline.mockResolvedValueOnce(page);

    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(mocks.timeline).toHaveBeenCalledTimes(1);
    expect(mocks.timeline).toHaveBeenCalledWith(parent, fullSelection);
    expect(ids(result)).toEqual(['full-1']);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'no_cache',
    });
  });

  it('document timelines include whole-thread tombstones and report nothing', async () => {
    mocks.timeline.mockResolvedValueOnce(fullPage());

    await messageTimelineQueryOptions(document, null).queryFn({
      pageParam: null,
    });

    expect(mocks.timeline).toHaveBeenCalledWith(document, {
      ...fullSelection,
      include_deleted_threads: true,
    });
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('rejoining a project replaces cached roots so missed edits and deletions recover', async () => {
    const project: MessageParent = { type: 'initiative', id: 'project-1' };
    const old = createMessage('old', '2026-09-10T12:00:00Z', {
      parent: project,
    });
    const deleted = createMessage('deleted', '2026-09-10T13:00:00Z', {
      parent: project,
    });
    testQueryClient.setQueryData<MessageTimelineData>(
      getMessageTimelineQueryKey(project, null),
      { pages: [fullPage([deleted, old])], pageParams: [null] }
    );
    mocks.timeline.mockResolvedValueOnce(
      fullPage([{ ...old, content: 'Edited while disconnected' }])
    );

    const result = await messageTimelineQueryOptions(project, null).queryFn({
      pageParam: null,
    });

    expect(timelineMessages(result).map((item) => item.content)).toEqual([
      'Edited while disconnected',
    ]);
    expect(mocks.timeline).toHaveBeenCalledWith(project, fullSelection);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('cache at latest fetches only roots newer than the newest cached root', async () => {
    const older = createMessage('msg-older', '2026-09-10T13:19:00.123456Z');
    const newer = createMessage('msg-newer', '2026-09-10T13:19:00.123457Z');
    seedLatestCache([older, newer]);
    const deltaItem = createMessage('msg-delta', '2026-09-10T13:20:00.000000Z');
    mocks.timeline.mockResolvedValueOnce({
      entries: entries([deltaItem]),
      next_cursor: cursor('msg-delta', '2026-09-10T13:20:00.000000Z'),
      previous_cursor: null,
    });

    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(mocks.timeline).toHaveBeenCalledTimes(1);
    expect(mocks.timeline).toHaveBeenCalledWith(parent, {
      cursor: { created_at: '2026-09-10T13:19:00.123457Z', id: 'msg-newer' },
      direction: 'newer',
      limit: 50,
      include_deleted_threads: false,
    });
    expect(ids(result)).toEqual(['msg-delta', 'msg-newer', 'msg-older']);
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
    mocks.timeline.mockResolvedValueOnce({
      entries: [],
      next_cursor: null,
      previous_cursor: null,
    });

    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(mocks.timeline).toHaveBeenCalledWith(
      parent,
      expect.objectContaining({ cursor: { created_at: time, id: 'msg-b' } })
    );
  });

  it('delta overflow falls back to the full timeline', async () => {
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00.123456Z')]);
    mocks.timeline.mockResolvedValueOnce({
      entries: entries(
        Array.from({ length: 50 }, (_, i) =>
          createMessage(`delta-${i}`, '2026-09-10T13:20:00Z')
        )
      ),
      next_cursor: cursor('delta-49', '2026-09-10T13:20:00Z'),
      previous_cursor: cursor('delta-0', '2026-09-10T13:20:00Z'),
    });
    const page = fullPage();
    mocks.timeline.mockResolvedValueOnce(page);

    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(mocks.timeline).toHaveBeenLastCalledWith(parent, fullSelection);
    expect(ids(result)).toEqual(['full-1']);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'delta_overflow',
      after: '2026-09-10T13:19:00.123456Z',
    });
  });

  it('cache away from latest uses the full timeline', async () => {
    const page = fullPage();
    mocks.timeline.mockResolvedValue(page);

    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00Z')], {
      pageParam: {
        next_cursor: cursor('older', '2026-09-10T13:00:00Z'),
        previous_cursor: null,
      },
    });
    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });
    expect(mocks.timeline).toHaveBeenCalledWith(parent, fullSelection);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'cache_not_at_latest',
    });

    mocks.track.mockClear();
    mocks.timeline.mockClear();
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00Z')], {
      previousCursor: cursor('newer', '2026-09-10T13:30:00Z'),
    });
    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });
    expect(mocks.timeline).toHaveBeenCalledTimes(1);
    expect(mocks.timeline).toHaveBeenCalledWith(parent, fullSelection);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'cache_not_at_latest',
    });
  });

  it('load-around stays on the full timeline', async () => {
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00Z')]);
    mocks.timeline.mockResolvedValueOnce(fullPage());

    await messageTimelineQueryOptions(parent, 'message-42').queryFn({
      pageParam: null,
    });

    expect(mocks.timeline).toHaveBeenCalledTimes(1);
    expect(mocks.timeline).toHaveBeenCalledWith(parent, {
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
    mocks.timeline.mockRejectedValueOnce(resultError('INTERNAL'));
    mocks.timeline.mockResolvedValueOnce(fullPage());

    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(ids(result)).toEqual(['full-1']);
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'catch_up_error',
      after: '2026-09-10T13:19:00.123456Z',
    });

    mocks.timeline.mockClear();
    mocks.track.mockClear();
    mocks.timeline.mockRejectedValueOnce(resultError('UNAUTHORIZED'));

    await expect(
      messageTimelineQueryOptions(parent, null).queryFn({
        pageParam: null,
      })
    ).rejects.toBeInstanceOf(ThrownResultError);
    expect(mocks.timeline).toHaveBeenCalledTimes(1);
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
    mocks.timeline.mockResolvedValueOnce({
      entries: entries([createMessage('msg-delta', '2026-09-10T13:20:00Z')]),
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
    mocks.timeline.mockImplementationOnce(async () => {
      await holdCatchUp;
      return {
        entries: entries([
          createMessage('msg-delta', '2026-09-10T13:20:00.000000Z'),
        ]),
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
    expect(ids(result)).toEqual(['msg-live', 'msg-delta', 'msg-1']);
    expect(timelineMessages(result)[0]?.content).toBe('from websocket');
  });

  it('later pages keep using the full timeline without an event', async () => {
    mocks.timeline.mockResolvedValueOnce(fullPage());
    const older = cursor('page-2', '2026-09-10T12:00:00Z');

    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: { next_cursor: older, previous_cursor: null },
    });

    expect(mocks.timeline).toHaveBeenCalledWith(parent, {
      limit: 100,
      cursor: older,
      direction: 'older',
      around: null,
      include_deleted_threads: false,
    });
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('newer pages page forward from the previous cursor', async () => {
    mocks.timeline.mockResolvedValueOnce(fullPage());
    const newer = cursor('page-0', '2026-09-10T15:00:00Z');

    await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: { next_cursor: null, previous_cursor: newer },
    });

    expect(mocks.timeline).toHaveBeenCalledWith(parent, {
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
        entries: entries([deltaNew, deltaDup]),
        next_cursor: cursor('ignore-me', '2026-09-10T13:19:00Z'),
        previous_cursor: cursor('also-ignore', '2026-09-10T13:20:00Z'),
      },
      {
        entries: entries([cached]),
        next_cursor: cachedNext,
        previous_cursor: cursor('cached-prev', '2026-09-10T13:30:00Z'),
      }
    );

    expect(ids(merged)).toEqual(['msg-2', 'msg-1']);
    expect(timelineMessages(merged)[1]?.content).toBe('from delta');
    expect(merged.next_cursor).toEqual(cachedNext);
    expect(merged.previous_cursor).toBeNull();
  });

  it('keeps a newer live insert ahead of older delta rows', () => {
    const cached = createMessage('msg-1', '2026-09-10T13:19:00Z');
    const live = createMessage('msg-live', '2026-09-10T13:21:00Z');
    const delta = createMessage('msg-delta', '2026-09-10T13:20:00Z');
    const merged = mergeCatchUpPage(
      {
        entries: entries([delta]),
        next_cursor: null,
        previous_cursor: null,
      },
      {
        entries: entries([live, cached]),
        next_cursor: cachedNext,
        previous_cursor: null,
      }
    );

    expect(ids(merged)).toEqual(['msg-live', 'msg-delta', 'msg-1']);
  });
});

describe('channel activity entries', () => {
  const activity = (id: string, occurredAt: string): TimelineActivity => ({
    id,
    actor_id: 'user-1',
    action: 'renamed',
    occurred_at: occurredAt,
    payload: { to: 'Planning' },
  });
  const keys = (page: { entries: MessageTimelineEntry[] }) =>
    page.entries.map(timelineEntryKey);

  function mixedPage(): MessageTimelineData {
    return {
      pages: [
        {
          entries: [
            {
              type: 'activity',
              activity: activity('shared-id', '2026-09-10T15:00:00Z'),
            },
            {
              type: 'message',
              message: createMessage('shared-id', '2026-09-10T14:00:00Z'),
            },
            {
              type: 'activity',
              activity: activity('older', '2026-09-10T13:00:00Z'),
            },
          ],
          next_cursor: cachedNext,
          previous_cursor: null,
        },
      ],
      pageParams: [null],
    };
  }

  it('catch-up merges activity newer than the newest cached root', async () => {
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00Z')]);
    mocks.timeline.mockResolvedValueOnce({
      entries: [
        { type: 'activity', activity: activity('a', '2026-09-10T13:20:00Z') },
      ],
      next_cursor: null,
      previous_cursor: null,
    });

    const result = await messageTimelineQueryOptions(parent, null).queryFn({
      pageParam: null,
    });

    expect(keys(result)).toEqual(['activity:a', 'msg-1']);
  });

  it('indexes rows oldest first and keeps activity out of message keys', () => {
    createRoot((dispose) => {
      const data = mixedPage();
      const index = createMessageIndex(() => data);
      expect(index.entryKeys).toEqual([
        'activity:older',
        'shared-id',
        'activity:shared-id',
      ]);
      expect(index.keys).toEqual(['shared-id']);
      expect(index.byId.get('shared-id')?.content).toBe('Message shared-id');
      expect(index.activityByKey.get('activity:older')?.id).toBe('older');
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
    const removed = removeTopLevelMessageFromMessageTimeline(data, 'shared-id');
    expect(keys(removed!.pages[0])).toEqual([
      'activity:shared-id',
      'activity:older',
    ]);
    expect(restoreTopLevelMessageInMessageTimeline(removed, snapshot)).toEqual(
      data
    );
  });

  it('inserts live activity by position within the loaded span only', () => {
    const data: MessageTimelineData = {
      pages: [
        {
          entries: entries([createMessage('newest', '2026-09-10T16:00:00Z')]),
          next_cursor: cursor('newest', '2026-09-10T16:00:00Z'),
          previous_cursor: null,
        },
        mixedPage().pages[0],
      ],
      pageParams: [null, null],
    };

    const inserted = insertActivitiesIntoMessageTimeline(data, [
      activity('between', '2026-09-10T14:30:00Z'),
      // Older than every loaded page: it arrives with its own page later.
      activity('unloaded', '2026-09-10T11:00:00Z'),
    ]);

    expect(inserted!.pages.map(keys)).toEqual([
      ['newest'],
      ['activity:shared-id', 'activity:between', 'shared-id', 'activity:older'],
    ]);
    expect(
      insertActivitiesIntoMessageTimeline(inserted, [
        activity('between', '2026-09-10T14:30:00Z'),
      ])
    ).toEqual(inserted);
  });
});
