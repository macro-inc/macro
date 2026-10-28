/** @vitest-environment jsdom */
import type { MessageListItem, MessageThread } from '@service-storage/messages';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type Accessor, createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CallChatHistory } from './CallChatHistory';

const mocks = vi.hoisted(() => ({
  source: undefined as unknown,
  refresh: vi.fn(),
}));
vi.mock('./queries/use-call-chat', () => ({ useCallChat: () => mocks.source }));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children: JSX.Element }) => props.children,
  })
);
vi.mock('@core/messages/MessageThread', () => ({
  threadListItem: (thread: MessageThread) => thread.root,
  MessageThread: (props: {
    data: MessageListItem;
    canWrite: boolean;
    targetId?: string;
    onClearTarget?: () => void;
    buildLink: (message: MessageListItem) => string;
  }) => (
    <>
      <p>
        {props.canWrite ? 'Writable' : 'Read only'}: {props.data.content}
      </p>
      <a href={props.buildLink(props.data)}>Message link</a>
      <button onClick={props.onClearTarget}>
        Target: {props.targetId ?? 'none'}
      </button>
    </>
  ),
}));

function source(thread: Accessor<MessageThread | undefined>, status = 'ready') {
  mocks.source = {
    thread,
    empty: () => status === 'empty',
    failed: () => status === 'error',
    loading: () => status === 'loading',
    refresh: mocks.refresh,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows the saved thread read-only and clears a linked message highlight', () => {
  const [target, setTarget] = createSignal<string | undefined>('reply-id');
  const root: MessageThread['root'] = {
    id: 'call-id',
    content: 'Saved chat',
    parent: { type: 'call', id: 'call-id' },
    sender_id: 'user-id',
    created_at: '2026-09-26T00:00:00Z',
    updated_at: '2026-09-26T00:00:00Z',
    attachments: [],
    mentions: [],
    reactions: [],
  };
  source(() => ({
    root,
    state: {
      root_id: 'call-id',
      user_id: 'user-id',
      resolved: false,
      created_at: root.created_at,
      updated_at: root.updated_at,
    },
    replies: [],
  }));
  render(() => (
    <CallChatHistory
      callId="call-id"
      targetId={target()}
      onClearTarget={() => setTarget(undefined)}
    />
  ));
  expect(screen.getByText('Read only: Saved chat')).toBeTruthy();
  const link = new URL(screen.getByRole('link').getAttribute('href')!);
  expect(link.pathname).toBe('/app/call/call-id');
  expect(link.searchParams.get('call_message_id')).toBe('call-id');
  fireEvent.click(screen.getByRole('button', { name: 'Target: reply-id' }));
  expect(screen.getByRole('button', { name: 'Target: none' })).toBeTruthy();
});

it('distinguishes an empty chat from a failed request with retry', () => {
  source(() => undefined, 'empty');
  const empty = render(() => <CallChatHistory callId="empty-call" />);
  expect(
    screen.getByText('No messages were sent during this call.')
  ).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  empty.unmount();
  source(() => undefined, 'error');
  render(() => <CallChatHistory callId="failed-call" />);
  expect(screen.getByRole('alert').textContent).toBe('Could not load chat.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
