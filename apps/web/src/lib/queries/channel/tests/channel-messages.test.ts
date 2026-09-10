vi.mock('@queries/messages/subscription', () => ({
  useMessageSubscription: () => {},
}));

/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMessageTimeline: vi.fn(),
}));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-storage/messages', () => ({
  entityMessagesClient: { list: mocks.getMessageTimeline },
}));

import {
  isMissingMessageError,
  messageTimelineQueryOptions,
} from '../../messages/timeline';

beforeEach(() => {
  testQueryClient = new QueryClient();
  mocks.getMessageTimeline.mockReset();
});

afterEach(() => {
  testQueryClient.clear();
});

describe('messageTimelineQueryOptions', () => {
  it.each(['NOT_FOUND', 'GONE'] as const)(
    'throws missing load-around messages without retrying them for %s',
    async (code) => {
      mocks.getMessageTimeline.mockRejectedValueOnce(
        new ThrownResultError([{ code, message: 'Message unavailable' }])
      );

      const options = messageTimelineQueryOptions(
        { type: 'channel', id: 'channel-1' },
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
      expect(isMissingMessageError(error)).toBe(true);
      expect(options.retry(0, error)).toBe(false);
      expect(mocks.getMessageTimeline).toHaveBeenCalledTimes(1);
      expect(mocks.getMessageTimeline).toHaveBeenCalledWith(
        { type: 'channel', id: 'channel-1' },
        {
          limit: 50,
          cursor: undefined,
          direction: 'older',
          around: 'message-missing',
          include_deleted_threads: false,
        }
      );
    }
  );

  it('preserves the default single retry for other errors', () => {
    const options = messageTimelineQueryOptions(
      { type: 'channel', id: 'channel-1' },
      null
    );

    expect(options.retry(0, new Error('network'))).toBe(true);
    expect(options.retry(1, new Error('network'))).toBe(false);
  });

  it('shares document roots with the annotation projection, including deletion state', async () => {
    const parent = { type: 'document' as const, id: 'document' };
    const annotations = messageTimelineQueryOptions(parent, null);
    mocks.getMessageTimeline.mockResolvedValue({ items: [] });
    await annotations.queryFn({ pageParam: null });
    expect(mocks.getMessageTimeline).toHaveBeenLastCalledWith(
      parent,
      expect.objectContaining({ include_deleted_threads: true })
    );
  });
});
