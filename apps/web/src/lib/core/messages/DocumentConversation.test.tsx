import type { ReferencedThread } from '@service-storage/generated/schemas/referencedThread';
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { type Accessor, createSignal, For, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentConversation } from './DocumentConversation';

const mocks = vi.hoisted(() => ({
  timeline: vi.fn(),
  linkResolved: true,
  contacts: [{ id: 'user|a@example.com', name: 'Ann', email: 'a@example.com' }],
  capturedParticipants: undefined as (() => Array<{ id: string }>) | undefined,
  references: vi.fn(),
  source: vi.fn(),
}));

vi.mock('@channel/Input', () => ({
  ChannelInput: (props: { participants?: () => Array<{ id: string }> }) => {
    mocks.capturedParticipants = props.participants;
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
vi.mock('@queries/contacts/contacts', () => ({
  useContacts: () => () => mocks.contacts,
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
    resolved: () => mocks.linkResolved,
  }),
}));
vi.mock('@queries/messages/mutations', () => ({
  useSendMessageMutation: () => ({}),
}));
vi.mock('@queries/messages/references', () => ({
  useChannelReferenceThreadsQuery: mocks.references,
}));
vi.mock('@queries/messages/timeline', () => ({
  useMessageTimelineQuery: mocks.timeline,
}));
vi.mock('./MessageThread', () => ({
  MessageThread: (props: { data: MessageListItem }) => (
    <article>
      {props.data.content}
      <For each={props.data.thread.preview}>
        {(reply) => <p>{reply.content}</p>}
      </For>
    </article>
  ),
  MessageThreadFromSource: (props: {
    parent: ReferencedThread['parent'];
    rootId: string;
    canWrite: boolean;
  }) => {
    mocks.source({
      parent: props.parent,
      rootId: props.rootId,
      canWrite: props.canWrite,
    });
    return <article>source {props.rootId}</article>;
  },
}));

afterEach(() => {
  mocks.linkResolved = true;
  mocks.capturedParticipants = undefined;
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

const sources: ReferencedThread[] = [
  {
    parent: { type: 'channel', id: 'launch' },
    root_id: 'source-a',
    channel_name: 'Launch',
    can_reply: true,
  },
  {
    parent: { type: 'channel', id: 'archive' },
    root_id: 'source-b',
    channel_name: null,
    can_reply: false,
  },
];

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
  const [referencesFailed, setReferencesFailed] = createSignal(false);
  mocks.timeline.mockReturnValue({
    isSuccess: true,
    get data() {
      return { pages: pages().map((items) => ({ items })) };
    },
  });
  mocks.references.mockImplementation(
    (_parent: unknown, enabled: Accessor<boolean>) => ({
      get isPending() {
        return !enabled();
      },
      get isSuccess() {
        return enabled() && !referencesFailed();
      },
      get isError() {
        return enabled() && referencesFailed();
      },
      get data() {
        return enabled() ? sources : undefined;
      },
    })
  );
  return {
    setPages,
    setReferencesFailed,
    ...render(() => (
      <DocumentConversation
        parent={{ type: 'document', id: 'document' }}
        canWrite={options.canWrite ?? false}
        targetId={targetId}
        hideComposer={options.hideComposer}
        hideWhenEmpty={options.hideWhenEmpty}
      />
    )),
  };
}

describe('DocumentConversation placement', () => {
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

  it('offers workspace contacts as @-mention participants', () => {
    discussion([[]], undefined, { canWrite: true });
    // Without participants the composer would suggest only agents and bots,
    // losing the user mentions the legacy comment input offered.
    expect(mocks.capturedParticipants?.()).toEqual(mocks.contacts);
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

  it('adds channel threads that mention the document only while requested, each against its source channel', () => {
    const view = discussion([[thread('discussion', null)]]);
    const toggle = view.getByRole<HTMLInputElement>('checkbox', {
      name: 'Include channel mentions',
    });
    expect(toggle.checked).toBe(false);
    expect(view.queryByText('source source-a')).toBeNull();
    expect(mocks.source).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(view.getAllByRole('article').map((el) => el.textContent)).toEqual([
      'discussion',
      'source source-a',
      'source source-b',
    ]);
    expect(
      view.getByRole('link', { name: 'From Launch' }).getAttribute('href')
    ).toBe('/channel/launch/source-a');
    expect(
      view
        .getByRole('link', { name: 'From Channel conversation' })
        .getAttribute('href')
    ).toBe('/channel/archive/source-b');
    expect(mocks.source.mock.calls.map(([props]) => props)).toEqual([
      {
        parent: { type: 'channel', id: 'launch' },
        rootId: 'source-a',
        canWrite: true,
      },
      {
        parent: { type: 'channel', id: 'archive' },
        rootId: 'source-b',
        canWrite: false,
      },
    ]);

    fireEvent.click(toggle);
    expect(view.getAllByRole('article').map((el) => el.textContent)).toEqual([
      'discussion',
    ]);
  });

  it('keeps the toggle inside a touch conversation and keeps shown source threads visible once the roots are gone', () => {
    const view = discussion([[]], undefined, {
      hideComposer: true,
      hideWhenEmpty: true,
    });
    expect(view.queryByRole('checkbox')).toBeNull();

    view.setPages([[thread('discussion', null)]]);
    fireEvent.click(
      view.getByRole('checkbox', { name: 'Include channel mentions' })
    );
    expect(view.getByText('source source-a')).toBeTruthy();

    view.setPages([[]]);
    expect(view.getByRole('button', { name: /Discussion/ })).toBeTruthy();
    expect(view.getAllByRole('article').map((el) => el.textContent)).toEqual([
      'source source-a',
      'source source-b',
    ]);

    // The disabled query still holds its last result; unchecking must not keep
    // an empty Discussion mounted on touch.
    fireEvent.click(
      view.getByRole('checkbox', { name: 'Include channel mentions' })
    );
    expect(view.queryByRole('button', { name: /Discussion/ })).toBeNull();
    expect(view.queryAllByRole('article')).toEqual([]);
  });

  it('keeps the last authorized source threads on a failed refresh and offers a retry', () => {
    const view = discussion([[thread('discussion', null)]]);
    fireEvent.click(
      view.getByRole('checkbox', { name: 'Include channel mentions' })
    );
    view.setReferencesFailed(true);
    expect(view.getAllByRole('article').map((el) => el.textContent)).toEqual([
      'discussion',
      'source source-a',
      'source source-b',
    ]);
    expect(
      view.getByRole('button', {
        name: 'Could not load channel mentions. Retry',
      })
    ).toBeTruthy();
    expect(
      view.queryByText('No channel threads mention this document.')
    ).toBeNull();
  });
});
