import type {
  Message,
  MessageListItem,
  MessageParent,
  MessageThread,
} from '@service-storage/messages';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;
const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  patchThread: vi.fn(),
  post: vi.fn(),
}));
vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: mocks }));
vi.mock('../subscription', () => ({ useMessageSubscription: () => {} }));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));

import { messageKeys } from '../keys';
import {
  newMessageId,
  useDeleteMessageMutation,
  usePatchThreadMutation,
  useSendMessageMutation,
} from '../mutations';
import { handleMessageEvent, onThreadStateUpdated } from '../sync';
import { getThreadRepliesQueryKey } from '../thread-replies';
import {
  getMessageTimelineQueryKey,
  type MessageTimelineData,
  useMessageTimelineQuery,
} from '../timeline';
import { timelineMessages } from '../timeline-entries';

const time = '2026-09-09T00:00:00Z';
function message(
  parent: MessageParent,
  id: string,
  threadId?: string
): Message {
  return {
    id,
    parent,
    thread_id: threadId,
    sender_id: 'macro|a@example.com',
    content: id,
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: time,
    updated_at: time,
  };
}

beforeEach(() => {
  mocks.delete.mockReset();
  mocks.patchThread.mockReset();
  mocks.post.mockReset();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  testQueryClient.clear();
});

it('reopens a resolved project discussion through the real mutation and shared timeline cache', async () => {
  const parent: MessageParent = { type: 'initiative', id: 'project' };
  const state = {
    root_id: 'root',
    user_id: 'macro|a@example.com',
    resolved: true,
    anchor: null,
    created_at: time,
    updated_at: time,
  };
  const root: MessageListItem = {
    ...message(parent, 'root'),
    state,
    thread: { reply_count: 0, preview: [] },
  };
  const timelineKey = getMessageTimelineQueryKey(parent);
  const threadKey = getThreadRepliesQueryKey(parent, 'root');
  testQueryClient.setQueryData<MessageTimelineData>(timelineKey, {
    pageParams: [null],
    pages: [
      {
        entries: [{ type: 'message', message: root }],
        next_cursor: null,
        previous_cursor: null,
      },
    ],
  });
  testQueryClient.setQueryData<MessageThread>(threadKey, {
    root,
    state,
    replies: [],
  });
  mocks.patchThread.mockResolvedValue({
    ...state,
    resolved: false,
    updated_at: '2026-09-09T01:00:00Z',
  });
  function Harness() {
    const timeline = useMessageTimelineQuery(
      () => parent,
      () => null
    );
    const mutation = usePatchThreadMutation();
    const resolved = () =>
      timeline.data &&
      timelineMessages(timeline.data.pages[0])[0].state.resolved;
    return (
      <>
        <span>{resolved() ? 'Resolved' : 'Open'}</span>
        <button
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              parent,
              rootId: 'root',
              patch: { resolved: !resolved() },
            })
          }
        >
          {resolved() ? 'Reopen discussion' : 'Resolve discussion'}
        </button>
      </>
    );
  }
  const view = render(() => (
    <QueryClientProvider client={testQueryClient}>
      <Harness />
    </QueryClientProvider>
  ));
  fireEvent.click(view.getByRole('button', { name: 'Reopen discussion' }));
  await waitFor(() =>
    expect(
      view.getByRole('button', { name: 'Resolve discussion' })
    ).toBeTruthy()
  );
  expect(mocks.patchThread).toHaveBeenCalledWith(parent, 'root', {
    resolved: false,
  });
  expect(view.getByText('Open')).toBeTruthy();
  expect(
    testQueryClient.getQueryData<MessageThread>(threadKey)?.state.resolved
  ).toBe(false);
  expect(
    timelineMessages(
      testQueryClient.getQueryData<MessageTimelineData>(timelineKey)!.pages[0]
    )[0].state.resolved
  ).toBe(false);
});

describe.each(['channel', 'document', 'call'] as const)(
  '%s reply deletion',
  (type) => {
    it.each(['before response', 'after response'] as const)(
      'applies deletion once when the live echo arrives %s',
      async (echoTiming) => {
        const parent: MessageParent = { type, id: 'parent' };
        const replies = [
          message(parent, 'first', 'root'),
          message(parent, 'second', 'root'),
        ];
        const state = {
          root_id: 'root',
          user_id: 'macro|a@example.com',
          resolved: false,
          created_at: time,
          updated_at: time,
          anchor: null,
        };
        const root: MessageListItem = {
          ...message(parent, 'root'),
          state,
          thread: { reply_count: 2, preview: replies, latest_reply_at: time },
        };
        const timelineKey = getMessageTimelineQueryKey(parent);
        const selectedKey = messageKeys.messagesByIds(parent, [
          'root',
        ]).queryKey;
        const threadKey = getThreadRepliesQueryKey(parent, 'root');
        testQueryClient.setQueryData<MessageTimelineData>(timelineKey, {
          pageParams: [null],
          pages: [
            {
              entries: [{ type: 'message', message: root }],
              next_cursor: null,
              previous_cursor: null,
            },
          ],
        });
        testQueryClient.setQueryData(selectedKey, [root]);
        testQueryClient.setQueryData<MessageThread>(threadKey, {
          state,
          root,
          replies,
        });
        const deleted = { ...replies[0], content: '', deleted_at: time };
        let echo: () => void = () => {};
        mocks.delete.mockImplementation(async (_parent, _id, nonce) => {
          echo = () =>
            handleMessageEvent({
              parent,
              actor: root.sender_id,
              nonce,
              change: { type: 'message_deleted', message: deleted },
            });
          if (echoTiming === 'before response') echo();
          return deleted;
        });
        let mutation!: ReturnType<typeof useDeleteMessageMutation>;
        function Harness() {
          mutation = useDeleteMessageMutation();
          return null;
        }
        render(() => (
          <QueryClientProvider client={testQueryClient}>
            <Harness />
          </QueryClientProvider>
        ));

        await mutation.mutateAsync({
          parent,
          messageID: 'first',
          threadID: 'root',
        });
        if (echoTiming === 'after response') echo();

        expect(
          timelineMessages(
            testQueryClient.getQueryData<MessageTimelineData>(timelineKey)!
              .pages[0]
          )[0].thread.reply_count
        ).toBe(1);
        expect(
          testQueryClient.getQueryData<MessageListItem[]>(selectedKey)![0]
            .thread.reply_count
        ).toBe(1);
        expect(
          testQueryClient
            .getQueryData<MessageThread>(threadKey)!
            .replies.map((reply) => reply.id)
        ).toEqual(['second']);
      }
    );
  }
);

describe('root deletion', () => {
  const threadState = (rootId: string) => ({
    root_id: rootId,
    user_id: 'macro|a@example.com',
    resolved: false,
    created_at: time,
    updated_at: time,
    anchor: { type: 'markdown' as const, mark_id: 'mark' },
  });

  /** A discussion whose replies were written by somebody else. */
  function seed(parent: MessageParent, withThreadCache = true) {
    const replies = [
      { ...message(parent, 'reply', 'root'), sender_id: 'macro|b@example.com' },
    ];
    const state = threadState('root');
    const root: MessageListItem = {
      ...message(parent, 'root'),
      state,
      thread: { reply_count: 1, preview: replies, latest_reply_at: time },
    };
    testQueryClient.setQueryData<MessageTimelineData>(
      getMessageTimelineQueryKey(parent),
      {
        pageParams: [null],
        pages: [
          {
            entries: [{ type: 'message', message: root }],
            next_cursor: null,
            previous_cursor: null,
          },
        ],
      }
    );
    if (withThreadCache)
      testQueryClient.setQueryData<MessageThread>(
        getThreadRepliesQueryKey(parent, 'root'),
        { state, root, replies }
      );
    return { root, replies, state };
  }

  function mount() {
    let mutation!: ReturnType<typeof useDeleteMessageMutation>;
    function Harness() {
      mutation = useDeleteMessageMutation();
      return null;
    }
    render(() => (
      <QueryClientProvider client={testQueryClient}>
        <Harness />
      </QueryClientProvider>
    ));
    return mutation;
  }

  const roots = (parent: MessageParent) =>
    testQueryClient
      .getQueryData<MessageTimelineData>(getMessageTimelineQueryKey(parent))!
      .pages.flatMap(timelineMessages);

  it.each(['document', 'initiative', 'crm_company', 'crm_contact'] as const)(
    "takes the whole %s discussion, including another author's replies",
    async (type) => {
      const parent: MessageParent = { type, id: 'parent' };
      seed(parent);
      mocks.delete.mockResolvedValue({
        ...message(parent, 'root'),
        content: '',
        deleted_at: time,
      });
      const deletedThreads: string[] = [];
      const stop = onThreadStateUpdated((_parent, state) => {
        if (state.deleted_at) deletedThreads.push(state.root_id);
      });

      await mount().mutateAsync({ parent, messageID: 'root' });

      expect(roots(parent)).toEqual([]);
      const thread = testQueryClient.getQueryData<MessageThread>(
        getThreadRepliesQueryKey(parent, 'root')
      )!;
      expect(thread.state.deleted_at).toBe(time);
      expect(thread.replies).toEqual([]);
      // The margin and the document mark clear off this notification.
      expect(deletedThreads).toEqual(['root']);
      stop();
    }
  );

  it.each(['document', 'initiative', 'crm_company', 'crm_contact'] as const)(
    'tears down a %s root whose replies were never opened',
    async (type) => {
      // The only copy of this thread's state is the timeline item the optimistic
      // delete removes, so the teardown has to read it before that happens.
      const parent: MessageParent = { type, id: 'parent' };
      seed(parent, false);
      mocks.delete.mockResolvedValue({
        ...message(parent, 'root'),
        content: '',
        deleted_at: time,
      });
      const deletedThreads: string[] = [];
      const stop = onThreadStateUpdated((_parent, state) => {
        if (state.deleted_at) deletedThreads.push(state.root_id);
      });

      await mount().mutateAsync({ parent, messageID: 'root' });

      expect(deletedThreads).toEqual(['root']);
      stop();
    }
  );

  it('restores the discussion when the delete fails', async () => {
    const parent: MessageParent = { type: 'document', id: 'doc' };
    const { root } = seed(parent);
    mocks.delete.mockRejectedValue(new Error('nope'));

    await expect(
      mount().mutateAsync({ parent, messageID: 'root' })
    ).rejects.toThrow();

    expect(roots(parent).map((item) => item.id)).toEqual([root.id]);
    const thread = testQueryClient.getQueryData<MessageThread>(
      getThreadRepliesQueryKey(parent, 'root')
    )!;
    expect(thread.state.deleted_at).toBeUndefined();
    expect(thread.replies).toHaveLength(1);
  });

  it('leaves a channel root as a tombstone above its replies', async () => {
    const parent: MessageParent = { type: 'channel', id: 'channel' };
    seed(parent);
    mocks.delete.mockResolvedValue({
      ...message(parent, 'root'),
      content: '',
      deleted_at: time,
    });

    await mount().mutateAsync({ parent, messageID: 'root' });

    expect(roots(parent).map((item) => !!item.deleted_at)).toEqual([true]);
    const thread = testQueryClient.getQueryData<MessageThread>(
      getThreadRepliesQueryKey(parent, 'root')
    )!;
    expect(thread.state.deleted_at).toBeUndefined();
    expect(thread.replies).toHaveLength(1);
  });

  it.each([false, true])(
    'preserves the canonical call root when deleted (has replies: %s)',
    async (withReplies) => {
      const parent: MessageParent = { type: 'call', id: 'root' };
      const { root, state, replies } = seed(parent);
      if (!withReplies) {
        testQueryClient.setQueryData<MessageThread>(
          getThreadRepliesQueryKey(parent, 'root'),
          { root, state, replies: [] }
        );
        testQueryClient.setQueryData<MessageTimelineData>(
          getMessageTimelineQueryKey(parent),
          {
            pageParams: [null],
            pages: [
              {
                entries: [
                  {
                    type: 'message',
                    message: {
                      ...root,
                      thread: {
                        reply_count: 0,
                        preview: [],
                        latest_reply_at: null,
                      },
                    },
                  },
                ],
                next_cursor: null,
                previous_cursor: null,
              },
            ],
          }
        );
      }
      mocks.delete.mockResolvedValue({
        ...root,
        content: '',
        deleted_at: time,
      });

      await mount().mutateAsync({ parent, messageID: 'root' });

      expect(roots(parent)).toHaveLength(1);
      const thread = testQueryClient.getQueryData<MessageThread>(
        getThreadRepliesQueryKey(parent, 'root')
      )!;
      expect(thread.root.deleted_at).toBeTruthy();
      expect(thread.state.deleted_at).toBeUndefined();
      expect(thread.replies).toEqual(withReplies ? replies : []);
    }
  );
});

describe('thread resolution', () => {
  const parent: MessageParent = { type: 'document', id: 'doc' };
  const state = {
    root_id: 'root',
    user_id: 'macro|a@example.com',
    resolved: false,
    created_at: time,
    updated_at: time,
    anchor: { type: 'markdown' as const, mark_id: 'mark' },
  };
  const timelineKey = getMessageTimelineQueryKey(parent);
  const threadKey = getThreadRepliesQueryKey(parent, 'root');
  const cachedResolved = () => ({
    timeline: timelineMessages(
      testQueryClient.getQueryData<MessageTimelineData>(timelineKey)!.pages[0]
    )[0].state.resolved,
    thread:
      testQueryClient.getQueryData<MessageThread>(threadKey)!.state.resolved,
  });

  function setup() {
    const root: MessageListItem = {
      ...message(parent, 'root'),
      state,
      thread: { reply_count: 0, preview: [], latest_reply_at: null },
    };
    testQueryClient.setQueryData<MessageTimelineData>(timelineKey, {
      pageParams: [null],
      pages: [
        {
          entries: [{ type: 'message', message: root }],
          next_cursor: null,
          previous_cursor: null,
        },
      ],
    });
    testQueryClient.setQueryData<MessageThread>(threadKey, {
      state,
      root,
      replies: [],
    });
    let mutation!: ReturnType<typeof usePatchThreadMutation>;
    function Harness() {
      mutation = usePatchThreadMutation();
      return null;
    }
    render(() => (
      <QueryClientProvider client={testQueryClient}>
        <Harness />
      </QueryClientProvider>
    ));
    return mutation;
  }

  it('shows the resolution before the server confirms it', async () => {
    let confirm!: () => void;
    mocks.patchThread.mockImplementation(
      () =>
        new Promise((resolve) => {
          confirm = () => resolve({ ...state, resolved: true });
        })
    );
    const mutation = setup();
    const pending = mutation.mutateAsync({
      parent,
      rootId: 'root',
      patch: { resolved: true },
    });
    await vi.waitFor(() =>
      expect(cachedResolved()).toEqual({ timeline: true, thread: true })
    );
    confirm();
    await pending;
    expect(cachedResolved()).toEqual({ timeline: true, thread: true });
  });

  it('restores the prior state when resolving fails', async () => {
    mocks.patchThread.mockRejectedValue(new Error('offline'));
    const mutation = setup();
    await expect(
      mutation.mutateAsync({
        parent,
        rootId: 'root',
        patch: { resolved: true },
      })
    ).rejects.toThrow('offline');
    expect(cachedResolved()).toEqual({ timeline: false, thread: false });
  });
});

describe('sending', () => {
  function mountSend() {
    let mutation!: ReturnType<typeof useSendMessageMutation>;
    function Harness() {
      mutation = useSendMessageMutation();
      return null;
    }
    render(() => (
      <QueryClientProvider client={testQueryClient}>
        <Harness />
      </QueryClientProvider>
    ));
    return mutation;
  }

  it.each([undefined, 'call-id'])(
    'adopts the canonical call root from a first send (requested thread: %s)',
    async (threadId) => {
      const parent: MessageParent = { type: 'call', id: 'call-id' };
      const timelineKey = getMessageTimelineQueryKey(parent);
      const threadKey = getThreadRepliesQueryKey(parent, parent.id);
      testQueryClient.setQueryData<MessageTimelineData>(timelineKey, {
        pageParams: [null],
        pages: [{ entries: [], next_cursor: null, previous_cursor: null }],
      });
      testQueryClient.setQueryData(threadKey, null);
      mocks.post.mockResolvedValue(message(parent, parent.id));

      await mountSend().mutateAsync({
        parent,
        message: { content: 'Hello', thread_id: threadId },
        senderId: 'macro|a@example.com',
        optimisticId: newMessageId(),
      });

      const roots = timelineMessages(
        testQueryClient.getQueryData<MessageTimelineData>(timelineKey)!.pages[0]
      );
      expect(roots.map((root) => [root.id, root.thread_id])).toEqual([
        ['call-id', undefined],
      ]);
      expect(testQueryClient.getQueryState(threadKey)?.isInvalidated).toBe(
        true
      );
    }
  );

  it('moves a racing initial call message into the canonical thread without duplicating its root', async () => {
    const parent: MessageParent = { type: 'call', id: 'call-id' };
    const timelineKey = getMessageTimelineQueryKey(parent);
    const threadKey = getThreadRepliesQueryKey(parent, parent.id);
    const root = message(parent, parent.id);
    const state = {
      root_id: root.id,
      user_id: root.sender_id,
      resolved: false,
      created_at: time,
      updated_at: time,
    };
    testQueryClient.setQueryData<MessageTimelineData>(timelineKey, {
      pageParams: [null],
      pages: [
        {
          entries: [
            {
              type: 'message',
              message: {
                ...root,
                state,
                thread: { reply_count: 0, preview: [], latest_reply_at: null },
              },
            },
          ],
          next_cursor: null,
          previous_cursor: null,
        },
      ],
    });
    testQueryClient.setQueryData<MessageThread>(threadKey, {
      root,
      state,
      replies: [],
    });
    const replyId = newMessageId();
    mocks.post.mockResolvedValue(message(parent, replyId, parent.id));

    await mountSend().mutateAsync({
      parent,
      message: { content: 'Hello from another participant' },
      senderId: 'macro|a@example.com',
      optimisticId: replyId,
    });

    const roots = timelineMessages(
      testQueryClient.getQueryData<MessageTimelineData>(timelineKey)!.pages[0]
    );
    expect(roots.map((item) => item.id)).toEqual([root.id]);
    expect(roots[0].thread.reply_count).toBe(1);
    const thread = testQueryClient.getQueryData<MessageThread>(threadKey)!;
    expect(thread.root.id).toBe(root.id);
    expect(thread.replies.map((reply) => [reply.id, reply.thread_id])).toEqual([
      [replyId, root.id],
    ]);
  });

  it.each([
    undefined,
    {
      type: 'spreadsheet' as const,
      sheetId: 'sheet-1',
      sheetName: 'Budget',
      range: 'B4:C9',
    },
  ])('keeps root identity and anchor across posting (%j)', async (anchor) => {
    const parent: MessageParent = { type: 'document', id: 'doc' };
    const timelineKey = getMessageTimelineQueryKey(parent);
    testQueryClient.setQueryData<MessageTimelineData>(timelineKey, {
      pageParams: [null],
      pages: [{ entries: [], next_cursor: null, previous_cursor: null }],
    });
    const rootIds = () =>
      testQueryClient
        .getQueryData<MessageTimelineData>(timelineKey)!
        .pages.flatMap(timelineMessages)
        .map((item) => [item.id, item.state.root_id]);
    let respond!: () => void;
    mocks.post.mockImplementation(
      (_parent, input) =>
        new Promise((resolve) => {
          respond = () => resolve(message(parent, input.id));
        })
    );
    let mutation!: ReturnType<typeof useSendMessageMutation>;
    function Harness() {
      mutation = useSendMessageMutation();
      return null;
    }
    render(() => (
      <QueryClientProvider client={testQueryClient}>
        <Harness />
      </QueryClientProvider>
    ));

    const id = newMessageId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    const pending = mutation.mutateAsync({
      parent,
      message: { content: '2+2=?', anchor },
      senderId: 'macro|a@example.com',
      optimisticId: id,
    });
    await vi.waitFor(() => expect(rootIds()).toEqual([[id, id]]));
    expect(mocks.post).toHaveBeenCalledWith(
      parent,
      expect.objectContaining({ id, nonce: id })
    );
    respond();
    await pending;
    expect(rootIds()).toEqual([[id, id]]);
    expect(
      timelineMessages(
        testQueryClient.getQueryData<MessageTimelineData>(timelineKey)!.pages[0]
      )[0].state.anchor
    ).toEqual(anchor ?? null);
  });

  it('adopts the server id when the server ignores the client id', async () => {
    const parent: MessageParent = { type: 'document', id: 'doc' };
    const timelineKey = getMessageTimelineQueryKey(parent);
    testQueryClient.setQueryData<MessageTimelineData>(timelineKey, {
      pageParams: [null],
      pages: [{ entries: [], next_cursor: null, previous_cursor: null }],
    });
    mocks.post.mockResolvedValue(message(parent, 'server-id'));
    let mutation!: ReturnType<typeof useSendMessageMutation>;
    function Harness() {
      mutation = useSendMessageMutation();
      return null;
    }
    render(() => (
      <QueryClientProvider client={testQueryClient}>
        <Harness />
      </QueryClientProvider>
    ));

    await mutation.mutateAsync({
      parent,
      message: { content: '2+2=?' },
      senderId: 'macro|a@example.com',
      optimisticId: newMessageId(),
    });
    // The row keeps its thread state, so a document discussion (which shows
    // roots with a null anchor) still renders it.
    expect(
      testQueryClient
        .getQueryData<MessageTimelineData>(timelineKey)!
        .pages.flatMap(timelineMessages)
        .map((item) => [item.id, item.state])
    ).toEqual([
      [
        'server-id',
        expect.objectContaining({ root_id: 'server-id', anchor: null }),
      ],
    ]);
  });
});
