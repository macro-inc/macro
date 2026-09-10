import { ok, err as resultErr } from 'neverthrow';
/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type { ApiChannelMessage } from '@service-storage/client';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getChannelMessages: vi.fn(),
  getChannelMessagesCatchUp: vi.fn(),
  track: vi.fn(),
}));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getChannelMessages: mocks.getChannelMessages,
    getChannelMessagesCatchUp: mocks.getChannelMessagesCatchUp,
  },
}));

vi.mock('@app/lib/analytics', () => ({
  analytics: {
    track: mocks.track,
  },
}));

import {
  type ChannelMessagesData,
  channelMessagesQueryOptions,
  getChannelMessagesQueryKey,
  isMissingChannelMessageError,
  mergeCatchUpPage,
} from '../channel-messages';
import { channelKeys } from '../keys';
import { normalizeChannelMessageSender } from '../message-sender';

function createMessage(
  id: string,
  createdAt: string,
  overrides: Partial<ApiChannelMessage> = {}
): ApiChannelMessage {
  return normalizeChannelMessageSender({
    id,
    channel_id: 'channel-1',
    sender_id: 'user-1',
    content: `Message ${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: undefined,
    edited_at: undefined,
    attachments: [],
    reactions: [],
    thread: {
      preview: [],
      reply_count: 0,
      latest_reply_at: null,
    },
    ...overrides,
  });
}

function seedLatestCache(
  items: ApiChannelMessage[],
  extras?: {
    nextCursor?: string | null;
    previousCursor?: string | null;
    pageParam?: { next_cursor: string | null; previous_cursor: string | null };
  }
) {
  const data: ChannelMessagesData = {
    pages: [
      {
        items,
        next_cursor: extras?.nextCursor ?? 'cached-next',
        previous_cursor: extras?.previousCursor ?? null,
      },
    ],
    pageParams: [extras?.pageParam ?? null],
  };
  testQueryClient.setQueryData(
    getChannelMessagesQueryKey('channel-1', null),
    data
  );
}

function fullPage(
  items: ApiChannelMessage[] = [createMessage('full-1', '2026-09-10T14:00:00Z')]
) {
  return {
    items,
    next_cursor: null,
    previous_cursor: null,
  };
}

beforeEach(() => {
  testQueryClient = new QueryClient();
  mocks.getChannelMessages.mockReset();
  mocks.getChannelMessagesCatchUp.mockReset();
  mocks.track.mockReset();
});

afterEach(() => {
  testQueryClient.clear();
});

describe('channelMessagesQueryOptions', () => {
  it.each(['NOT_FOUND', 'GONE'] as const)(
    'throws missing load-around messages without retrying them for %s',
    async (code) => {
      mocks.getChannelMessages.mockResolvedValueOnce(
        resultErr([{ code, message: 'Message unavailable' }])
      );

      const options = channelMessagesQueryOptions(
        'channel-1',
        'message-missing'
      );

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
      expect(isMissingChannelMessageError(error)).toBe(true);
      expect(options.retry(0, error)).toBe(false);
      expect(mocks.getChannelMessages).toHaveBeenCalledTimes(1);
      expect(mocks.getChannelMessages).toHaveBeenCalledWith({
        channel_id: 'channel-1',
        limit: 50,
        next_cursor: null,
        previous_cursor: null,
        load_around_message_id: 'message-missing',
      });
    }
  );

  it('preserves the default single retry for other errors', () => {
    const options = channelMessagesQueryOptions('channel-1', null);

    expect(options.retry(0, new Error('network'))).toBe(true);
    expect(options.retry(1, new Error('network'))).toBe(false);
  });

  it('first load without cache uses the full endpoint', async () => {
    const page = fullPage();
    mocks.getChannelMessages.mockResolvedValueOnce(ok(page));

    const result = await channelMessagesQueryOptions('channel-1', null).queryFn(
      { pageParam: null }
    );

    expect(mocks.getChannelMessages).toHaveBeenCalledTimes(1);
    expect(mocks.getChannelMessages).toHaveBeenCalledWith({
      channel_id: 'channel-1',
      limit: 50,
      next_cursor: null,
      previous_cursor: null,
      load_around_message_id: null,
    });
    expect(mocks.getChannelMessagesCatchUp).not.toHaveBeenCalled();
    expect(result.items.map((item) => item.id)).toEqual(['full-1']);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'no_cache',
    });
  });

  it('cache at latest uses catch-up with the newest cached created_at', async () => {
    const older = createMessage('msg-older', '2026-09-10T13:19:00.123456Z');
    const newer = createMessage('msg-newer', '2026-09-10T13:19:00.123457Z');
    seedLatestCache([older, newer]);
    const deltaItem = createMessage('msg-delta', '2026-09-10T13:20:00.000000Z');
    mocks.getChannelMessagesCatchUp.mockResolvedValueOnce(
      ok({
        items: [deltaItem],
        next_cursor: null,
        previous_cursor: null,
      })
    );

    const result = await channelMessagesQueryOptions('channel-1', null).queryFn(
      { pageParam: null }
    );

    expect(mocks.getChannelMessagesCatchUp).toHaveBeenCalledWith({
      channel_id: 'channel-1',
      after: '2026-09-10T13:19:00.123457Z',
      limit: 50,
      next_cursor: null,
      previous_cursor: null,
    });
    expect(mocks.getChannelMessages).not.toHaveBeenCalled();
    expect(result.items.map((item) => item.id)).toEqual([
      'msg-delta',
      'msg-newer',
      'msg-older',
    ]);
    expect(result.next_cursor).toBe('cached-next');
    expect(result.previous_cursor).toBeNull();
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'catch_up',
      reason: 'watermark',
      after: '2026-09-10T13:19:00.123457Z',
    });
  });

  it('delta overflow falls back to the full endpoint', async () => {
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00.123456Z')]);
    mocks.getChannelMessagesCatchUp.mockResolvedValueOnce(
      ok({
        items: Array.from({ length: 50 }, (_, i) =>
          createMessage(`delta-${i}`, '2026-09-10T13:20:00Z')
        ),
        next_cursor: 'overflow',
        previous_cursor: null,
      })
    );
    const page = fullPage();
    mocks.getChannelMessages.mockResolvedValueOnce(ok(page));

    const result = await channelMessagesQueryOptions('channel-1', null).queryFn(
      { pageParam: null }
    );

    expect(mocks.getChannelMessages).toHaveBeenCalledWith({
      channel_id: 'channel-1',
      limit: 50,
      next_cursor: null,
      previous_cursor: null,
      load_around_message_id: null,
    });
    expect(result.items.map((item) => item.id)).toEqual(['full-1']);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'delta_overflow',
      after: '2026-09-10T13:19:00.123456Z',
    });
  });

  it('cache away from latest uses the full endpoint', async () => {
    const page = fullPage();
    mocks.getChannelMessages.mockResolvedValue(ok(page));

    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00Z')], {
      pageParam: { next_cursor: 'older', previous_cursor: null },
    });
    await channelMessagesQueryOptions('channel-1', null).queryFn({
      pageParam: null,
    });
    expect(mocks.getChannelMessagesCatchUp).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'cache_not_at_latest',
    });

    mocks.track.mockClear();
    mocks.getChannelMessages.mockClear();
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00Z')], {
      previousCursor: 'newer',
    });
    await channelMessagesQueryOptions('channel-1', null).queryFn({
      pageParam: null,
    });
    expect(mocks.getChannelMessagesCatchUp).not.toHaveBeenCalled();
    expect(mocks.getChannelMessages).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'cache_not_at_latest',
    });
  });

  it('load-around stays on the full endpoint', async () => {
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00Z')]);
    mocks.getChannelMessages.mockResolvedValueOnce(ok(fullPage()));

    await channelMessagesQueryOptions('channel-1', 'message-42').queryFn({
      pageParam: null,
    });

    expect(mocks.getChannelMessages).toHaveBeenCalledWith({
      channel_id: 'channel-1',
      limit: 50,
      next_cursor: null,
      previous_cursor: null,
      load_around_message_id: 'message-42',
    });
    expect(mocks.getChannelMessagesCatchUp).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'load_around',
    });
  });

  it('catch-up failure falls back except on auth errors', async () => {
    seedLatestCache([createMessage('msg-1', '2026-09-10T13:19:00.123456Z')]);
    mocks.getChannelMessagesCatchUp.mockResolvedValueOnce(
      resultErr([{ code: 'INTERNAL', message: 'boom' }])
    );
    mocks.getChannelMessages.mockResolvedValueOnce(ok(fullPage()));

    const result = await channelMessagesQueryOptions('channel-1', null).queryFn(
      { pageParam: null }
    );

    expect(result.items.map((item) => item.id)).toEqual(['full-1']);
    expect(mocks.getChannelMessages).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith('channel_messages_load', {
      channelId: 'channel-1',
      path: 'full',
      reason: 'catch_up_error',
      after: '2026-09-10T13:19:00.123456Z',
    });

    mocks.getChannelMessages.mockClear();
    mocks.track.mockClear();
    mocks.getChannelMessagesCatchUp.mockResolvedValueOnce(
      resultErr([{ code: 'UNAUTHORIZED', message: 'nope' }])
    );

    await expect(
      channelMessagesQueryOptions('channel-1', null).queryFn({
        pageParam: null,
      })
    ).rejects.toBeInstanceOf(ThrownResultError);
    expect(mocks.getChannelMessages).not.toHaveBeenCalled();
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
    mocks.getChannelMessagesCatchUp.mockResolvedValueOnce(
      ok({
        items: [createMessage('msg-delta', '2026-09-10T13:20:00Z')],
        next_cursor: null,
        previous_cursor: null,
      })
    );

    await channelMessagesQueryOptions('channel-1', null).queryFn({
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
    mocks.getChannelMessagesCatchUp.mockImplementationOnce(async () => {
      await holdCatchUp;
      return ok({
        items: [createMessage('msg-delta', '2026-09-10T13:20:00.000000Z')],
        next_cursor: null,
        previous_cursor: null,
      });
    });

    const pending = channelMessagesQueryOptions('channel-1', null).queryFn({
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

  it('later pages keep using the full endpoint without an event', async () => {
    mocks.getChannelMessages.mockResolvedValueOnce(ok(fullPage()));

    await channelMessagesQueryOptions('channel-1', null).queryFn({
      pageParam: { next_cursor: 'page-2', previous_cursor: null },
    });

    expect(mocks.getChannelMessages).toHaveBeenCalledWith({
      channel_id: 'channel-1',
      limit: 100,
      next_cursor: 'page-2',
      previous_cursor: null,
      load_around_message_id: null,
    });
    expect(mocks.getChannelMessagesCatchUp).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
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
        next_cursor: 'ignore-me',
        previous_cursor: 'also-ignore',
      },
      {
        items: [cached],
        next_cursor: 'cached-next',
        previous_cursor: 'cached-prev',
      }
    );

    expect(merged.items.map((item) => item.id)).toEqual(['msg-2', 'msg-1']);
    expect(merged.items[1]?.content).toBe('from delta');
    expect(merged.next_cursor).toBe('cached-next');
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
        next_cursor: 'cached-next',
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
