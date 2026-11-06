import type { Span } from '@macro-inc/observability';
import type {
  MessageListItem,
  MessageParent,
  MessageTimelinePage,
} from '@service-storage/messages';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const setAttr = vi.fn();
  const spanError = vi.fn();
  return {
    timeline: vi.fn(),
    reportError: vi.fn(),
    setAttr,
    spanError,
    trace: vi.fn(
      async (
        _name: string,
        work: (span: Pick<Span, 'setAttr' | 'error'>) => Promise<void>
      ) => {
        await work({ setAttr, error: spanError });
      }
    ),
  };
});
let queryClient: QueryClient;
vi.mock('../../client', () => ({
  get queryClient() {
    return queryClient;
  },
}));
vi.mock('@service-storage/messages', () => ({
  entityMessagesClient: { timeline: mocks.timeline },
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: mocks.reportError, span: mocks.trace },
}));
vi.mock('../subscription', () => ({ useMessageSubscription() {} }));

import {
  applyThreadState,
  handleMessageEvent,
  handleTimelineActivity,
} from '../sync';
import {
  type MessageTimelineData,
  messageTimelineQueryOptions,
} from '../timeline';
import { timelineMessages } from '../timeline-entries';

const parent: MessageParent = { type: 'channel', id: 'channel-1' };
const root: MessageListItem = {
  id: 'root',
  parent,
  thread_id: null,
  sender_id: 'user-1',
  mentions: [],
  content: 'Existing root',
  created_at: '2026-10-15T14:28:00Z',
  updated_at: '2026-10-15T14:28:00Z',
  attachments: [],
  reactions: [],
  state: {
    root_id: 'root',
    user_id: 'user-1',
    resolved: false,
    anchor: null,
    created_at: '2026-10-15T14:28:00Z',
    updated_at: '2026-10-15T14:28:00Z',
  },
  thread: { reply_count: 0, preview: [], latest_reply_at: null },
};
const missedReply = {
  ...root,
  id: 'missed-reply',
  thread_id: root.id,
  content: 'Missed while disconnected',
  created_at: '2026-10-15T14:29:00Z',
};
const liveReply = {
  ...missedReply,
  id: 'live-reply',
  content: 'Posted during reconnect',
  created_at: '2026-10-15T14:31:00Z',
};
const disposers: (() => void)[] = [];

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.timeline.mockReset();
  mocks.reportError.mockReset();
  mocks.trace.mockClear();
  mocks.setAttr.mockClear();
  mocks.spanError.mockClear();
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  queryClient.clear();
  vi.restoreAllMocks();
});

it.each(['message', 'activity', 'thread'] as const)(
  'reports a failed %s timeline restart instead of leaving its promise unhandled',
  async (event) => {
    const failure = new Error('Unable to restart the timeline');
    const reported = Promise.withResolvers<void>();
    mocks.reportError.mockImplementation(() => reported.resolve());
    const cache = queryClient.getQueryCache();
    const findAll = cache.findAll.bind(cache);
    vi.spyOn(cache, 'findAll').mockImplementation((filters) => {
      if (filters?.type === 'active') throw failure;
      return findAll(filters);
    });

    if (event === 'message') {
      handleMessageEvent({
        parent,
        actor: 'user-2',
        change: {
          type: 'posted',
          message: liveReply,
          mentions: [],
          notification_policy: 'Default',
        },
      });
    } else if (event === 'activity') {
      handleTimelineActivity({
        parent,
        activities: [
          {
            id: 'activity',
            actor_id: 'user-2',
            action: 'renamed',
            occurred_at: '2026-10-15T14:33:00Z',
            payload: { to: 'Renamed channel' },
          },
        ],
      });
    } else {
      applyThreadState(parent, { ...root.state, resolved: true });
    }

    await reported.promise;
    expect(mocks.reportError).toHaveBeenCalledExactlyOnceWith(failure, {
      surface: 'messages-sync',
    });
  }
);

it.each(['reaction', 'reply'] as const)(
  'recovers missed replies even when a live %s changes the same root during refresh',
  async (change) => {
    const options = messageTimelineQueryOptions(parent, null);
    const initial: MessageTimelinePage = {
      entries: [{ type: 'message', message: root }],
      next_cursor: null,
      previous_cursor: null,
    };
    queryClient.setQueryData<MessageTimelineData>(options.queryKey, {
      pages: [initial],
      pageParams: [null],
    });
    const observer = new InfiniteQueryObserver(queryClient, options);
    disposers.push(observer.subscribe(() => {}));
    const outdated = Promise.withResolvers<MessageTimelinePage>();
    const refreshed = {
      ...root,
      reactions:
        change === 'reaction' ? [{ emoji: '❤️', users: ['user-2'] }] : [],
      thread: {
        reply_count: change === 'reply' ? 2 : 1,
        preview: change === 'reply' ? [missedReply, liveReply] : [missedReply],
        latest_reply_at:
          change === 'reply' ? liveReply.created_at : missedReply.created_at,
      },
    };
    mocks.timeline.mockReturnValueOnce(outdated.promise).mockResolvedValueOnce({
      ...initial,
      entries: [{ type: 'message', message: refreshed }],
    });

    const firstFetch = observer.refetch();
    handleMessageEvent({
      parent,
      actor: 'user-2',
      change:
        change === 'reaction'
          ? {
              type: 'reaction_changed',
              message: { ...root, reactions: refreshed.reactions },
              added: true,
              emoji: '❤️',
            }
          : {
              type: 'posted',
              message: liveReply,
              mentions: [],
              notification_policy: 'Default',
            },
    });
    const finalFetch = queryClient
      .getQueryCache()
      .find({ queryKey: options.queryKey })?.promise;
    outdated.resolve(initial);
    await Promise.all([firstFetch, finalFetch]);

    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(mocks.trace).toHaveBeenCalledExactlyOnceWith(
      'channel.timeline_restart',
      expect.any(Function)
    );
    await mocks.trace.mock.results[0].value;
    expect(mocks.setAttr.mock.calls).toEqual([
      ['channel.id', parent.id],
      ['query.count', 1],
      ['query.fetch_more_directions', ['refetch']],
      ['query.outcomes', ['fulfilled']],
      ['query.fulfilled_count', 1],
      ['query.rejected_count', 0],
    ]);
    expect(mocks.spanError).not.toHaveBeenCalled();
    const data = queryClient.getQueryData<MessageTimelineData>(
      options.queryKey
    );
    expect(data?.pages[0].entries).toMatchObject([
      { type: 'message', message: refreshed },
    ]);
  }
);

it.each(['root', 'reply', 'edit', 'delete', 'thread', 'activity'] as const)(
  'restarts the whole paginated refresh when a live %s arrives after page one resolves',
  async (change) => {
    const older = { ...root, id: 'older', created_at: '2026-10-15T14:00:00Z' };
    const live = {
      ...root,
      id: 'new-root',
      created_at: '2026-10-15T14:32:00Z',
    };
    const cursor = { id: root.id, created_at: root.created_at };
    const latest: MessageTimelinePage = {
      entries: [{ type: 'message', message: root }],
      next_cursor: cursor,
      previous_cursor: null,
    };
    const history: MessageTimelinePage = {
      entries: [{ type: 'message', message: older }],
      next_cursor: null,
      previous_cursor: null,
    };
    const options = messageTimelineQueryOptions(parent, null);
    queryClient.setQueryData<MessageTimelineData>(options.queryKey, {
      pages: [latest, history],
      pageParams: [null, { next_cursor: cursor, previous_cursor: null }],
    });
    const observer = new InfiniteQueryObserver(queryClient, options);
    disposers.push(observer.subscribe(() => {}));
    const historyRequested = Promise.withResolvers<void>();
    const outdatedHistory = Promise.withResolvers<MessageTimelinePage>();
    const activity = {
      id: 'activity',
      actor_id: 'user-2',
      action: 'renamed' as const,
      occurred_at: '2026-10-15T14:33:00Z',
      payload: { to: 'Renamed channel' },
    };
    const updatedRoot =
      change === 'reply'
        ? {
            ...root,
            thread: {
              reply_count: 1,
              preview: [liveReply],
              latest_reply_at: liveReply.created_at,
            },
          }
        : change === 'thread'
          ? { ...root, state: { ...root.state, resolved: true } }
          : root;
    const refreshed: MessageTimelinePage = {
      ...latest,
      entries: [
        ...(change === 'root'
          ? [{ type: 'message' as const, message: live }]
          : []),
        ...(change === 'activity'
          ? [{ type: 'activity' as const, activity }]
          : []),
        { type: 'message', message: updatedRoot },
      ],
    };
    const refreshedHistory: MessageTimelinePage = {
      ...history,
      entries:
        change === 'delete'
          ? []
          : [
              {
                type: 'message',
                message:
                  change === 'edit'
                    ? { ...older, content: 'Live edit on older page' }
                    : older,
              },
            ],
    };
    mocks.timeline
      .mockResolvedValueOnce(latest)
      .mockImplementationOnce(() => {
        historyRequested.resolve();
        return outdatedHistory.promise;
      })
      .mockResolvedValueOnce(refreshed)
      .mockResolvedValueOnce(refreshedHistory);

    const firstFetch = observer.refetch();
    await historyRequested.promise;
    if (change === 'activity') {
      handleTimelineActivity({ parent, activities: [activity] });
    } else if (change === 'thread') {
      applyThreadState(parent, updatedRoot.state);
    } else {
      handleMessageEvent({
        parent,
        actor: 'user-2',
        change:
          change === 'root' || change === 'reply'
            ? {
                type: 'posted',
                message: change === 'root' ? live : liveReply,
                mentions: [],
                notification_policy: 'Default',
              }
            : change === 'edit'
              ? {
                  type: 'edited',
                  message: { ...older, content: 'Live edit on older page' },
                  previous_attachments: [],
                  mentions: [],
                  notification_policy: 'Default',
                }
              : {
                  type: 'message_deleted',
                  message: { ...older, deleted_at: '2026-10-15T14:33:00Z' },
                },
      });
    }
    const finalFetch = queryClient
      .getQueryCache()
      .find({ queryKey: options.queryKey })?.promise;
    outdatedHistory.resolve(history);
    await Promise.all([firstFetch, finalFetch]);

    expect(mocks.timeline).toHaveBeenCalledTimes(4);
    const data = queryClient.getQueryData<MessageTimelineData>(
      options.queryKey
    );
    expect(data?.pages).toMatchObject([refreshed, refreshedHistory]);
    expect(
      data?.pages.flatMap(timelineMessages).map((message) => message.id)
    ).toEqual(
      change === 'root'
        ? ['new-root', 'root', 'older']
        : change === 'delete'
          ? ['root']
          : ['root', 'older']
    );
  }
);

it.each(['older', 'newer'] as const)(
  'preserves pending %s pagination when a live edit restarts its request',
  async (direction) => {
    const cursor = { id: root.id, created_at: root.created_at };
    const options = messageTimelineQueryOptions(parent, null);
    queryClient.setQueryData<MessageTimelineData>(options.queryKey, {
      pages: [
        {
          entries: [{ type: 'message', message: root }],
          next_cursor: direction === 'older' ? cursor : null,
          previous_cursor: direction === 'newer' ? cursor : null,
        },
      ],
      pageParams: [null],
    });
    const observer = new InfiniteQueryObserver(queryClient, options);
    disposers.push(observer.subscribe(() => {}));
    const delayed = Promise.withResolvers<MessageTimelinePage>();
    const next = {
      ...root,
      id: direction,
      created_at:
        direction === 'older' ? '2026-10-15T14:00:00Z' : '2026-10-15T14:32:00Z',
    };
    const page: MessageTimelinePage = {
      entries: [{ type: 'message', message: next }],
      next_cursor: null,
      previous_cursor: null,
    };
    mocks.timeline
      .mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce(page);

    const firstFetch =
      direction === 'older'
        ? observer.fetchNextPage()
        : observer.fetchPreviousPage();
    handleMessageEvent({
      parent,
      actor: 'user-2',
      change: {
        type: 'edited',
        message: { ...root, content: 'Live edit' },
        mentions: [],
        notification_policy: 'Default',
        previous_attachments: [],
      },
    });
    const finalFetch = queryClient
      .getQueryCache()
      .find({ queryKey: options.queryKey })?.promise;
    delayed.resolve(page);
    await Promise.all([firstFetch, finalFetch]);

    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    await mocks.trace.mock.results[0].value;
    expect(mocks.setAttr).toHaveBeenCalledWith('query.fetch_more_directions', [
      direction === 'older' ? 'forward' : 'backward',
    ]);
    expect(mocks.setAttr).toHaveBeenCalledWith('query.outcomes', ['fulfilled']);
    for (const call of mocks.timeline.mock.calls) {
      expect(call).toEqual([
        parent,
        {
          limit: 100,
          cursor,
          direction,
          around: null,
          include_deleted_threads: false,
        },
      ]);
    }
    const data = queryClient.getQueryData<MessageTimelineData>(
      options.queryKey
    );
    expect(data?.pages).toHaveLength(2);
    expect(
      data?.pages.flatMap(timelineMessages).map((message) => message.id)
    ).toEqual(direction === 'older' ? ['root', 'older'] : ['newer', 'root']);
    expect(
      data?.pages
        .flatMap(timelineMessages)
        .find((message) => message.id === root.id)?.content
    ).toBe('Live edit');
  }
);

it.each(['partial', 'all'] as const)(
  'records %s restart failures without exposing request errors or rejecting the flow',
  async (failed) => {
    const page: MessageTimelinePage = {
      entries: [{ type: 'message', message: root }],
      next_cursor: null,
      previous_cursor: null,
    };
    const options = [
      messageTimelineQueryOptions(parent, null),
      messageTimelineQueryOptions(parent, root.id),
    ];
    const observers = options.map((queryOptions) => {
      queryClient.setQueryData<MessageTimelineData>(queryOptions.queryKey, {
        pages: [page],
        pageParams: [null],
      });
      const observer = new InfiniteQueryObserver(queryClient, {
        ...queryOptions,
        retry: false,
      });
      disposers.push(observer.subscribe(() => {}));
      return observer;
    });
    const oldFirst = Promise.withResolvers<MessageTimelinePage>();
    const oldSecond = Promise.withResolvers<MessageTimelinePage>();
    const failure = new Error('Request error containing private data');
    mocks.timeline
      .mockReturnValueOnce(oldFirst.promise)
      .mockReturnValueOnce(oldSecond.promise);
    if (failed === 'all') mocks.timeline.mockRejectedValueOnce(failure);
    else
      mocks.timeline.mockResolvedValueOnce({
        ...page,
        entries: [
          {
            type: 'message',
            message: { ...root, state: { ...root.state, resolved: true } },
          },
        ],
      });
    mocks.timeline.mockRejectedValueOnce(failure);
    const initialFetches = observers.map((observer) => observer.refetch());

    applyThreadState(parent, { ...root.state, resolved: true });
    oldFirst.resolve(page);
    oldSecond.resolve(page);
    await Promise.all(initialFetches);
    expect(mocks.trace).toHaveBeenCalledExactlyOnceWith(
      'channel.timeline_restart',
      expect.any(Function)
    );
    await mocks.trace.mock.results[0].value;

    expect(mocks.setAttr.mock.calls).toEqual([
      ['channel.id', parent.id],
      ['query.count', 2],
      ['query.fetch_more_directions', ['refetch', 'refetch']],
      [
        'query.outcomes',
        [failed === 'all' ? 'rejected' : 'fulfilled', 'rejected'],
      ],
      ['query.fulfilled_count', failed === 'all' ? 0 : 1],
      ['query.rejected_count', failed === 'all' ? 2 : 1],
    ]);
    expect(mocks.spanError).toHaveBeenCalledExactlyOnceWith(
      'Channel timeline restart failed'
    );
    expect(mocks.reportError).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(options[1].queryKey)?.error).toBe(failure);
  }
);

it('does not fetch idle channels for ordinary live updates', () => {
  const options = messageTimelineQueryOptions(parent, null);
  queryClient.setQueryData<MessageTimelineData>(options.queryKey, {
    pages: [
      {
        entries: [{ type: 'message', message: root }],
        next_cursor: null,
        previous_cursor: null,
      },
    ],
    pageParams: [null],
  });
  const observer = new InfiniteQueryObserver(queryClient, options);
  disposers.push(observer.subscribe(() => {}));

  handleMessageEvent({
    parent,
    actor: 'user-2',
    change: {
      type: 'posted',
      message: liveReply,
      mentions: [],
      notification_policy: 'Default',
    },
  });

  expect(mocks.timeline).not.toHaveBeenCalled();
  expect(mocks.trace).not.toHaveBeenCalled();
  expect(
    queryClient.getQueryData<MessageTimelineData>(options.queryKey)?.pages[0]
      .entries
  ).toMatchObject([
    {
      type: 'message',
      message: { thread: { reply_count: 1, preview: [liveReply] } },
    },
  ]);
});
