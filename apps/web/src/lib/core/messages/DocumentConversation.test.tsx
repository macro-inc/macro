import type { MessageListItem } from '@service-storage/messages';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { type Accessor, createSignal, For, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentConversation } from './DocumentConversation';

const mocks = vi.hoisted(() => ({ timeline: vi.fn(), references: vi.fn() }));

vi.mock('@channel/Input', () => ({ ChannelInput: () => null }));
vi.mock('@channel/Input/message-payload', () => ({}));
vi.mock('@channel/Thread/utils/message-actions', () => ({
  buildMessageLink: () => '/channel/source',
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
vi.mock('@queries/messages', () => ({
  useChannelReferenceThreadsQuery: mocks.references,
  useMessageLink: (_parent: unknown, target: Accessor<string | null>) => ({
    messageId: target,
    rootId: target,
  }),
}));
vi.mock('@queries/messages/mutations', () => ({
  useSendMessageMutation: () => ({}),
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
  MessageThreadFromSource: () => <article>Source channel thread</article>,
}));

afterEach(cleanup);

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

function discussion(initialPages: MessageListItem[][], targetId?: string) {
  const [pages, setPages] = createSignal(initialPages);
  mocks.timeline.mockReturnValue({
    isSuccess: true,
    get data() {
      return { pages: pages().map((items) => ({ items })) };
    },
  });
  mocks.references.mockReturnValue({
    isSuccess: true,
    data: [
      {
        root_id: 'source',
        parent: { type: 'channel', id: 'channel' },
        channel_name: 'Launch',
        can_reply: true,
      },
    ],
  });
  return {
    setPages,
    ...render(() => (
      <DocumentConversation
        parent={{ type: 'document', id: 'document' }}
        canWrite={false}
        targetId={targetId}
      />
    )),
  };
}

describe('DocumentConversation placement', () => {
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

  it('still includes source channel threads when requested', () => {
    const view = discussion([[thread('anchored', anchor)]]);
    fireEvent.click(
      view.getByRole('checkbox', { name: 'Include channel mentions' })
    );

    expect(view.getByText('Source channel thread')).toBeTruthy();
    expect(view.queryByText('anchored')).toBeNull();
  });
});
