import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  timeline: vi.fn(),
  replies: vi.fn(),
  host: vi.fn((): object | undefined => undefined),
}));
vi.mock('@queries/messages/local/channel-flag', () => ({
  channelCacheHost: mocks.host,
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    prefetchInfiniteQuery: mocks.timeline,
    prefetchQuery: mocks.replies,
  },
}));
vi.mock('@queries/messages/timeline', () => ({
  messageTimelineQueryOptions: (parent: unknown, messageId: string) => ({
    parent,
    messageId,
  }),
}));
vi.mock('@queries/messages/thread-replies', () => ({
  threadRepliesQueryOptions: (parent: unknown, threadId: string) => ({
    parent,
    threadId,
  }),
}));

import {
  prefetchChannelTarget,
  prefetchLatestChannelMessages,
} from './prefetch-channel-target';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.timeline.mockResolvedValue(undefined);
  mocks.replies.mockResolvedValue(undefined);
  mocks.host.mockReturnValue(undefined);
});

describe('channel target prefetch', () => {
  it('starts the root window directly without resolving a known root', async () => {
    await prefetchChannelTarget('channel-1', {
      messageId: 'root-1',
      threadId: 'root-1',
    });
    expect(mocks.timeline).toHaveBeenCalledExactlyOnceWith({
      parent: { type: 'channel', id: 'channel-1' },
      messageId: 'root-1',
    });
    expect(mocks.replies).not.toHaveBeenCalled();
  });

  it('starts the root window and reply fetch together', async () => {
    let finishTimeline!: () => void;
    mocks.timeline.mockReturnValue(
      new Promise<void>((resolve) => {
        finishTimeline = resolve;
      })
    );
    const pending = prefetchChannelTarget('channel-1', {
      messageId: 'reply-1',
      threadId: 'root-1',
    });
    expect(mocks.timeline).toHaveBeenCalledExactlyOnceWith({
      parent: { type: 'channel', id: 'channel-1' },
      messageId: 'root-1',
    });
    expect(mocks.replies).toHaveBeenCalledExactlyOnceWith({
      parent: { type: 'channel', id: 'channel-1' },
      threadId: 'root-1',
    });
    finishTimeline();
    await pending;
  });

  it('leaves ambiguous links to the mounted surface instead of fetching latest', async () => {
    await prefetchChannelTarget('channel-1', { messageId: 'reply-1' });
    expect(mocks.timeline).not.toHaveBeenCalled();
    expect(mocks.replies).not.toHaveBeenCalled();
  });
});

describe('on the device path', () => {
  it('prefetches no REST page, which the device reader would not use', async () => {
    mocks.host.mockReturnValue({});
    await prefetchChannelTarget('channel-1', {
      messageId: 'reply-1',
      threadId: 'root-1',
    });
    prefetchLatestChannelMessages('channel-1');
    expect(mocks.timeline).not.toHaveBeenCalled();
    expect(mocks.replies).not.toHaveBeenCalled();
  });
});
