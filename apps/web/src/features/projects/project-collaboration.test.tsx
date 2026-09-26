import type { MessageData } from '@core/messages/types';
import type { MessageListItem, MessageParent } from '@service-storage/messages';
import { cleanup, render } from '@solidjs/testing-library';
import { type Accessor, createSignal, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectDiscussion } from './project-collaboration';

const mocks = vi.hoisted(() => ({
  timeline: vi.fn(),
  link: vi.fn(),
}));

vi.mock('@channel/Input', () => ({
  ChannelInput: (props: { parent: MessageParent }) => (
    <textarea
      aria-label="Leave a comment..."
      data-parent-type={props.parent.type}
      data-parent-id={props.parent.id}
    />
  ),
}));
vi.mock('@channel/Input/message-payload', () => ({}));
vi.mock('@channel/use-channel-bot-mention-users', () => ({
  useMessageBotMentionUsers: () => [],
}));
vi.mock('@queries/contacts/contacts', () => ({
  useContacts: () => () => [],
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: ParentProps) => props.children,
  })
);
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@queries/messages/document-messages', () => ({
  useMessageLink: mocks.link,
}));
vi.mock('@queries/messages/mutations', () => ({
  useSendMessageMutation: () => ({}),
}));
vi.mock('@queries/messages/timeline', () => ({
  useMessageTimelineQuery: mocks.timeline,
}));
vi.mock('@core/messages/MessageThread', () => ({
  MessageThread: (props: {
    data: MessageListItem;
    allowResolve?: boolean;
    buildLink?: (message: MessageData) => string;
  }) => (
    <article data-allow-resolve={props.allowResolve === true}>
      <a href={props.buildLink?.(props.data)}>{props.data.content}</a>
    </article>
  ),
}));

const projectId = '01a0ca52-f1bc-7682-be89-7b12e79a0651';
const oldId = '01a0ca55-520e-7941-ae1b-847e0ead8fc2';
const newId = '01a0ca55-520e-7941-ae1b-847e0ead8fc3';

function message(id: string, content: string): MessageListItem {
  return {
    id,
    parent: { type: 'initiative', id: projectId },
    sender_id: 'user',
    content,
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: '2026-09-09T00:00:00Z',
    updated_at: '2026-09-09T00:00:00Z',
    state: {
      root_id: id,
      user_id: 'user',
      resolved: false,
      anchor: null,
      created_at: '2026-09-09T00:00:00Z',
      updated_at: '2026-09-09T00:00:00Z',
    },
    thread: { preview: [], reply_count: 0, latest_reply_at: null },
  };
}

function setup(targetId?: string) {
  mocks.link.mockImplementation(
    (_parent: Accessor<MessageParent>, target: Accessor<string | null>) => ({
      messageId: target,
      rootId: target,
      resolved: () => true,
      error: () => null,
    })
  );
  mocks.timeline.mockReturnValue({
    isSuccess: true,
    data: {
      pages: [
        {
          items: [message(newId, 'New comment'), message(oldId, 'Old comment')],
        },
      ],
    },
  });
  const [canWrite, setCanWrite] = createSignal(true);
  return {
    setCanWrite,
    ...render(() => (
      <ProjectDiscussion
        projectId={projectId}
        canWrite={canWrite()}
        targetId={targetId}
      />
    )),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('project discussion uses the task conversation', () => {
  it('reads initiative comments in chronological order with the composer below', () => {
    const view = setup();
    const [parent] = mocks.timeline.mock.calls[0];
    expect(parent()).toEqual({ type: 'initiative', id: projectId });
    expect(view.getByRole('button', { name: /Discussion/ })).toBeTruthy();
    expect(view.queryByText('Activity')).toBeNull();
    const comments = view.getAllByRole('article');
    expect(comments.map((comment) => comment.textContent)).toEqual([
      'Old comment',
      'New comment',
    ]);
    expect(
      comments.every((comment) => comment.dataset.allowResolve === 'false')
    ).toBe(true);
    const composer = view.getByRole('textbox');
    expect(composer.dataset.parentType).toBe('initiative');
    expect(composer.dataset.parentId).toBe(projectId);
    expect(
      comments[1].compareDocumentPosition(composer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('removes the composer when project comment access is revoked', () => {
    const view = setup();
    expect(view.getByRole('textbox')).toBeTruthy();
    view.setCanWrite(false);
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.getAllByRole('article')).toHaveLength(2);
  });

  it('resolves discussion targets and builds project Overview links', () => {
    const view = setup(oldId);
    const [parent, target] = mocks.link.mock.calls[0];
    expect(parent()).toEqual({ type: 'initiative', id: projectId });
    expect(target()).toBe(oldId);
    const url = new URL(
      view.getByRole('link', { name: 'Old comment' }).getAttribute('href')!
    );
    expect(url.pathname).toBe(
      `/app/component/initiative-view~${projectId}~overview~${oldId}`
    );
  });
});
