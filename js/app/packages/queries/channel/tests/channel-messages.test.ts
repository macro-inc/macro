/**
 * @vitest-environment jsdom
 */

import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaybeResultError } from '@core/util/maybeResult';

const mocks = vi.hoisted(() => ({
  getChannelMessages: vi.fn(),
}));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-comms/client', () => ({
  commsServiceClient: {
    getChannelMessages: mocks.getChannelMessages,
  },
}));

import {
  channelMessagesQueryOptions,
  isMissingChannelMessageError,
} from '../channel-messages';

beforeEach(() => {
  testQueryClient = new QueryClient();
  mocks.getChannelMessages.mockReset();
});

afterEach(() => {
  testQueryClient.clear();
});

describe('channelMessagesQueryOptions', () => {
  it.each([
    'NOT_FOUND',
    'GONE',
  ] as const)('throws missing load-around messages without retrying them for %s', async (code) => {
    mocks.getChannelMessages.mockResolvedValueOnce([
      [{ code, message: 'Message unavailable' }],
      null,
    ]);

    const options = channelMessagesQueryOptions('channel-1', 'message-missing');

    let error: unknown;
    try {
      await options.queryFn({ pageParam: null });
    } catch (err) {
      error = err;
    }

    if (!(error instanceof Error)) {
      throw new Error('Expected queryFn to throw an Error');
    }

    expect(error).toBeInstanceOf(MaybeResultError);
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
  });

  it('preserves the default single retry for other errors', () => {
    const options = channelMessagesQueryOptions('channel-1', null);

    expect(options.retry(0, new Error('network'))).toBe(true);
    expect(options.retry(1, new Error('network'))).toBe(false);
  });
});
