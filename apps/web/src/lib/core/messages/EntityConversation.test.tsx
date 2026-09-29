import { ThrownResultError } from '@core/util/result';
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { type Accessor, createSignal, For, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityConversation } from './EntityConversation';
import { EntityDiscussion } from './EntityDiscussion';

const mocks = vi.hoisted(() => ({
  timeline: vi.fn(),
  linkResolved: true,
  capturedParent: undefined as { type: string; id: string } | undefined,
  linkError: null as unknown,
  refetchLink: vi.fn(),
  urlTarget: undefined as string | undefined,
  scroll: vi.fn(() => () => {}),
}));

vi.mock('@core/component/ParamsProvider', () => ({
  useUrlParams: () => ({ commentId: () => mocks.urlTarget }),
  useParamNavigationCount: () => () => 0,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('./scroll-to-rendered-target', () => ({
  scrollToRenderedTarget: mocks.scroll,
}));

vi.mock('@channel/Input', () => ({
  ChannelInput: (props: { parent?: { type: string; id: string } }) => {
    mocks.capturedParent = props.parent;
    return <textarea aria-label="Leave a comment..." />;
  },
}));
vi.mock('@channel/Input/message-payload', () => ({}));
vi.mock('@channel/Thread/utils/message-actions', () => ({
  buildMessageLink: (channelId: string, messageId: string) =>
    `/channel/${channelId}/${messageId}`,
}));
vi.mock('@channel/use-channel-bot-mention-users', () => ({
  useMessageBotMentionUsers: () => [],
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: ParentProps) => props.children,
  })
);
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@queries/messages/document-messages', () => ({
  useMessageLink: (_parent: unknown, target: Accessor<string | null>) => ({
    messageId: target,
    rootId: () => {
      const id = target();
      return id ? `root-of-${id}` : null;
    },
    resolved: () => !target() || mocks.linkResolved,
    error: () => mocks.linkError,
    refetch: mocks.refetchLink,
  }),
}));
vi.mock('@queries/messages/mutations', () => ({
  useSendMessageMutation: () => ({}),
}));
vi.mock('@queries/messages/timeline', () => ({
  useMessageTimelineQuery: mocks.timeline,
}));
vi.mock('./MessageThread', () => ({
  MessageThread: (props: {
    data: MessageListItem;
    targetId?: string | null;
    onClearTarget?: () => void;
  }) => (
    <article
      data-target={props.targetId ?? undefined}
      onClick={() => props.onClearTarget?.()}
    >
      {props.data.content}
      <For each={props.data.thread.preview}>
        {(reply) => <p>{reply.content}</p>}
      </For>
    </article>
  ),
}));

afterEach(() => {
  mocks.linkResolved = true;
  mocks.capturedParent = undefined;
  mocks.linkError = null;
  mocks.urlTarget = undefined;
  mocks.scroll.mockClear();
  cleanup();
});

function thread(
  id: string,
  anchor: MessageListItem['state']['anchor']
): MessageListItem {
  return {
    id,
    parent: { type: 'document', id: 'document' },
    sender_id: 'user',
    content: id,
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: '2026-09-09T00:00:00Z',
    updated_at: '2026-09-09T00:00:00Z',
    state: {
      root_id: id,
      user_id: 'user',
      resolved: false,
      anchor,
      created_at: '2026-09-09T00:00:00Z',
      updated_at: '2026-09-09T00:00:00Z',
    },
    thread: { preview: [], reply_count: 0, latest_reply_at: null },
  };
}

const anchor = { type: 'markdown', mark_id: 'mark' } as const;

describe('EntityDiscussion target ownership', () => {
  it('keeps the latest timeline and disclosure state when the host rejects a URL target', () => {
    mocks.urlTarget = 'range-reply';
    mocks.linkResolved = false;
    mocks.timeline.mockReturnValue({
      isSuccess: true,
      data: { pages: [{ items: [thread('Latest workbook topic', null)] }] },
    });
    const view = render(() => (
      <EntityDiscussion
        parent={{ type: 'document', id: 'document' }}
        canWrite={false}
        link={{ type: 'spreadsheet', id: 'document' }}
        targetId={null}
      />
    ));
    const [, around, enabled] = mocks.timeline.mock.calls.at(-1)!;
    expect(around()).toBeNull();
    expect(enabled()).toBe(true);
    expect(view.getByText('Latest workbook topic')).toBeTruthy();
    expect(view.queryByText('Loading comments...')).toBeNull();
    expect(mocks.scroll).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Discussion' }));
    expect(view.queryByText('Latest workbook topic')).toBeNull();
  });

  it.each([undefined, 'workbook-reply'])(
    'windows and highlights an owned workbook link (override: %s)',
    (targetId) => {
      mocks.urlTarget = 'workbook-reply';
      mocks.timeline.mockReturnValue({
        isSuccess: true,
        data: { pages: [{ items: [thread('root-of-workbook-reply', null)] }] },
      });
      const view = render(() => (
        <EntityDiscussion
          parent={{ type: 'document', id: 'document' }}
          canWrite={false}
          link={{ type: 'spreadsheet', id: 'document' }}
          targetId={targetId}
        />
      ));
      const [, around, enabled] = mocks.timeline.mock.calls.at(-1)!;
      expect(around()).toBe('root-of-workbook-reply');
      expect(enabled()).toBe(true);
      expect(view.getByRole('article').dataset.target).toBe('workbook-reply');
      expect(mocks.scroll).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'workbook-reply'
      );
    }
  );
});

function discussion(
  initialPages: MessageListItem[][],
  targetId?: string,
  options: {
    canWrite?: boolean;
    hideComposer?: boolean;
    hideWhenEmpty?: boolean;
  } = {}
) {
  const [pages, setPages] = createSignal(initialPages);
  mocks.timeline.mockReturnValue({
    isSuccess: true,
    get data() {
      return { pages: pages().map((items) => ({ items })) };
    },
  });
  return {
    setPages,
    ...render(() => (
      <EntityConversation
        parent={{ type: 'document', id: 'document' }}
        canWrite={options.canWrite ?? false}
        targetId={targetId}
        hideComposer={options.hideComposer}
        hideWhenEmpty={options.hideWhenEmpty}
      />
    )),
  };
}

describe('EntityConversation placement', () => {
  it('keeps spreadsheet range threads out of the workbook discussion', () => {
    const view = discussion(
      [
        [
          thread('Workbook topic', null),
          thread('Range topic', {
            type: 'spreadsheet',
            sheetId: 'sheet-1',
            sheetName: 'Budget',
            range: 'B4:C9',
          }),
        ],
      ],
      undefined,
      { canWrite: true }
    );
    expect(view.getByText('Workbook topic')).toBeTruthy();
    expect(view.queryByText('Range topic')).toBeNull();
    expect(mocks.capturedParent).toEqual({ type: 'document', id: 'document' });
    expect(view.getByRole('textbox')).toBeTruthy();
  });

  it('renders the Discussion disclosure as an icon instead of a text glyph', () => {
    const view = discussion([[]]);
    const button = view.getByRole('button', { name: 'Discussion' });
    expect(button.querySelector('svg')).toBeTruthy();
    expect(button.textContent?.trim()).toBe('Discussion');
  });

  it('leaves the inline composer to a floating placement and hides an empty conversation on request', () => {
    const view = discussion([[]], undefined, {
      canWrite: true,
      hideComposer: true,
      hideWhenEmpty: true,
    });
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.queryByRole('button', { name: /Discussion/ })).toBeNull();

    view.setPages([[thread('first discussion', null)]]);
    expect(view.getByRole('button', { name: /Discussion/ })).toBeTruthy();
    expect(view.queryByRole('textbox')).toBeNull();
  });

  it('renders the inline composer for writers by default', () => {
    const view = discussion([[]], undefined, { canWrite: true });
    expect(view.getByRole('textbox')).toBeTruthy();
  });

  it('names the document as the composer parent so it resolves the same mentions as a reply', () => {
    discussion([[]], undefined, { canWrite: true });
    expect(mocks.capturedParent).toEqual({ type: 'document', id: 'document' });
  });

  it('shows nothing from the shared latest page while a link is still resolving', () => {
    mocks.linkResolved = false;
    const view = discussion([[thread('new discussion', null)]], 'reply');
    expect(view.queryAllByRole('article')).toEqual([]);
    expect(view.getByText('Loading comments...')).toBeTruthy();
    const [, , enabled] = mocks.timeline.mock.calls.at(-1)!;
    expect(enabled()).toBe(false);
  });

  it('loads a linked view around the linked message root once the link resolved', () => {
    discussion([[thread('new discussion', null)]], 'reply');
    const [, around, enabled] = mocks.timeline.mock.calls.at(-1)!;
    expect(around()).toBe('root-of-reply');
    expect(enabled()).toBe(true);
  });

  it('hides deleted discussions while their state remains available for mark cleanup', () => {
    const deleted = thread('deleted discussion', null);
    deleted.state.deleted_at = '2026-09-09T01:00:00Z';
    const view = discussion([[deleted, thread('live discussion', null)]]);
    expect(view.getAllByRole('article').map((el) => el.textContent)).toEqual([
      'live discussion',
    ]);
  });

  it.each([undefined, 'anchored'])(
    'keeps anchored threads and replies out of Discussion, including linked views (%s)',
    (targetId) => {
      const anchored = thread('anchored', anchor);
      anchored.thread.preview = [
        { ...thread('anchored reply', null), thread_id: anchored.id },
      ];
      const view = discussion(
        [
          [thread('new discussion', null), anchored],
          [thread('old discussion', null)],
        ],
        targetId
      );

      expect(view.getAllByRole('article').map((el) => el.textContent)).toEqual([
        'old discussion',
        'new discussion',
      ]);
      expect(view.queryByText('anchored reply')).toBeNull();
    }
  );

  it('does not flash live roots before their anchor metadata arrives', () => {
    const view = discussion([[thread('existing discussion', null)]]);
    view.setPages([
      [
        thread('remote anchored', undefined),
        thread('remote discussion', undefined),
        thread('optimistic anchored', anchor),
        thread('optimistic discussion', null),
        thread('existing discussion', null),
      ],
    ]);
    expect(view.getAllByRole('article').map((el) => el.textContent)).toEqual([
      'existing discussion',
      'optimistic discussion',
    ]);

    view.setPages([
      [
        thread('remote anchored', anchor),
        thread('remote discussion', null),
        thread('optimistic anchored', anchor),
        thread('optimistic discussion', null),
        thread('existing discussion', null),
      ],
    ]);
    expect(view.getAllByRole('article').map((el) => el.textContent)).toEqual([
      'existing discussion',
      'optimistic discussion',
      'remote discussion',
    ]);
  });
});

describe('EntityConversation linked message highlight', () => {
  it('releases the highlight while keeping the linked view around its root', () => {
    const [cleared, setCleared] = createSignal(false);
    mocks.timeline.mockReturnValue({
      isSuccess: true,
      data: { pages: [{ items: [thread('root-of-reply', null)] }] },
    });
    const view = render(() => (
      <EntityConversation
        parent={{ type: 'document', id: 'document' }}
        canWrite={false}
        targetId="reply"
        targetCleared={cleared()}
        onClearTarget={() => setCleared(true)}
      />
    ));
    const article = view.getByRole('article');
    expect(article.dataset.target).toBe('reply');
    article.click();
    expect(article.dataset.target).toBeUndefined();
    const [, around] = mocks.timeline.mock.calls.at(-1)!;
    expect(around()).toBe('root-of-reply');
  });
});

it('retains loaded comments on a pagination failure and removes them immediately on access loss', () => {
  const [error, setError] = createSignal<unknown>();
  const [fetching, setFetching] = createSignal(true);
  const loadMore = vi.fn();
  mocks.timeline.mockReturnValue({
    isPending: false,
    get isError() {
      return !!error();
    },
    get error() {
      return error();
    },
    get isFetching() {
      return fetching();
    },
    data: { pages: [{ items: [thread('Known discussion', null)] }] },
    hasNextPage: true,
    fetchNextPage: loadMore,
  });
  const view = render(() => (
    <EntityConversation
      parent={{ type: 'initiative', id: 'project' }}
      canWrite
    />
  ));
  const load = view.getByRole('button', { name: 'Load earlier comments' });
  expect(load.hasAttribute('disabled')).toBe(true);
  fireEvent.click(load);
  expect(loadMore).not.toHaveBeenCalled();

  setFetching(false);
  setError(new Error('Network disconnected'));
  expect(view.getByText('Known discussion')).toBeTruthy();
  expect(view.getByRole('textbox')).toBeTruthy();
  expect(load.hasAttribute('disabled')).toBe(false);

  setError(
    new ThrownResultError([{ code: 'FORBIDDEN', message: 'No access' }])
  );
  expect(view.queryAllByRole('article')).toHaveLength(0);
  expect(view.queryByRole('textbox')).toBeNull();
  expect(
    view.queryByRole('button', { name: 'Load earlier comments' })
  ).toBeNull();
});

it('hides cached comments when a linked message denies access and retries the link', () => {
  mocks.linkError = new ThrownResultError([
    { code: 'FORBIDDEN', message: 'No access' },
  ]);
  const refetch = vi.fn();
  mocks.timeline.mockReturnValue({
    isPending: false,
    data: { pages: [{ items: [thread('Cached discussion', null)] }] },
    refetch,
  });
  const view = render(() => (
    <EntityConversation
      parent={{ type: 'initiative', id: 'project' }}
      targetId="linked-message"
      canWrite
    />
  ));
  expect(view.queryAllByRole('article')).toHaveLength(0);
  expect(view.queryByRole('textbox')).toBeNull();
  fireEvent.click(
    view.getByRole('button', { name: 'Could not load comments. Retry' })
  );
  expect(refetch).toHaveBeenCalled();
  expect(mocks.refetchLink).toHaveBeenCalled();
});
