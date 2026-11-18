/** @vitest-environment jsdom */
import type { ChannelInputProps } from '@channel/Input/ChannelInput';
import type { InputHandle, InputSnapshot } from '@channel/Input/types';
import { MessageReferenceNavigation } from '@core/messages/message-reference-navigation';
import {
  useMessageTransport,
  useMessageViewerOverride,
} from '@core/messages/message-transport';
import type { MessageActionHandler } from '@core/messages/types';
import type { MessageListItem, MessageThread } from '@service-storage/messages';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, useContext } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import CallChat from './CallChat';

const mocks = vi.hoisted(() => ({
  source: undefined as unknown,
  guestSource: undefined as unknown,
  composer: undefined as ChannelInputProps | undefined,
  restore: vi.fn(),
  snapshot: vi.fn(),
  send: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
  focus: vi.fn(),
}));
vi.mock('./queries/use-call-chat', () => ({ useCallChat: () => mocks.source }));
vi.mock('./queries/use-guest-call-thread', () => ({
  useGuestCallThread: () => mocks.guestSource,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-id' }));
vi.mock('@queries/messages/mutations', () => ({
  useSendMessageMutation: () => ({ mutateAsync: mocks.send }),
  newMessageId: () => 'new-message',
}));
vi.mock('@channel/Input', () => ({
  ChannelInput: (props: ChannelInputProps) => {
    mocks.composer = props;
    const handle: InputHandle = {
      snapshot: mocks.snapshot,
      clear: vi.fn(),
      focus: mocks.focus,
      send: vi.fn(),
      attachFiles: vi.fn(),
      restoreSnapshot: mocks.restore,
    };
    props.onReady?.(handle);
    return <div data-testid="call-composer" />;
  },
}));
vi.mock('./components/CallChatBody', () => ({
  CallChatBody: (props: { children: JSX.Element; composer: JSX.Element }) => (
    <>
      {props.children}
      {props.composer}
    </>
  ),
}));
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
    onReply?: MessageActionHandler;
    targetId?: string;
    targetRequestKey?: string | number;
  }) => {
    const navigate = useContext(MessageReferenceNavigation);
    const transport = useMessageTransport();
    const viewer = useMessageViewerOverride();
    return (
      <>
        <span data-testid="viewer">{viewer?.()}</span>
        <button
          onClick={() =>
            transport?.react({
              parent: props.data.parent,
              id: props.data.id,
              emoji: '👍',
              add: true,
            })
          }
        >
          React
        </button>
        <button onClick={() => props.onReply?.({ message: props.data })}>
          Reply
        </button>
        <button
          onClick={() =>
            navigate?.({
              parent: props.data.parent,
              targetMessageId: props.data.id,
              targetThreadId: 'call-id',
              displayText: props.data.content,
              senderId: props.data.sender_id,
            })
          }
        >
          Quoted message
        </button>
        <span data-testid="target" data-request-key={props.targetRequestKey}>
          {props.targetId}
        </span>
      </>
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each(['user-id', 'another-user'])(
  'quotes a message from %s into the existing draft and sends in the call thread',
  async (senderId) => {
    const root: MessageThread['root'] = {
      id: 'call-id',
      parent: { type: 'call', id: 'call-id' },
      sender_id: senderId,
      content: 'Original message',
      created_at: '2026-09-28T00:00:00Z',
      updated_at: '2026-09-28T00:00:00Z',
      attachments: [],
      mentions: [],
      reactions: [],
    };
    mocks.source = {
      thread: () => ({ root, replies: [] }),
      parent: () => root.parent,
      empty: () => false,
      loading: () => false,
      failed: () => false,
      refresh: mocks.refresh,
    };
    render(() => (
      <CallChat
        access={{ kind: 'member' }}
        callId="call-id"
        open
        onClose={() => {}}
      />
    ));
    const draft: InputSnapshot = {
      value: 'Existing draft',
      mentions: [{ itemType: 'user', itemId: 'bot|owned-agent' }],
      attachments: [{ id: 'file-id', name: 'Notes', kind: 'document' }],
    };
    // A draft restored from persistence has not emitted onChange yet.
    mocks.snapshot.mockReturnValue(draft);
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(screen.getAllByTestId('call-composer')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Quoted message' }));
    expect(screen.getByTestId('target').textContent).toBe('call-id');
    const target = screen.getByTestId('target');
    const composer = screen.getByTestId('call-composer');
    const firstRequest = target.getAttribute('data-request-key');
    fireEvent.click(screen.getByRole('button', { name: 'Quoted message' }));
    expect(target.getAttribute('data-request-key')).not.toBe(firstRequest);
    expect(screen.getByTestId('target')).toBe(target);
    expect(screen.getByTestId('call-composer')).toBe(composer);
    expect(mocks.restore).toHaveBeenCalledOnce();
    expect(mocks.restore).toHaveBeenCalledWith(
      {
        ...draft,
        value: expect.stringContaining('"targetThreadId":"call-id"'),
      },
      { cursor: 'trailing-paragraph' }
    );
    const quoted: InputSnapshot = mocks.restore.mock.calls[0][0];
    expect(quoted.value).toContain('"parent":{"type":"call","id":"call-id"}');
    expect(quoted.value).toMatch(/\n\nExisting draft$/);
    await mocks.composer?.onSend?.(quoted);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: root.parent,
        message: expect.objectContaining({
          thread_id: 'call-id',
          content: quoted.value,
          mentions: [{ entity_type: 'bot', entity_id: 'bot|owned-agent' }],
          attachments: [expect.objectContaining({ entity_id: 'file-id' })],
        }),
      })
    );
  }
);

it('only autofocuses when the panel opens, not when a tab becomes visible', () => {
  mocks.source = {
    thread: () => undefined,
    parent: () => ({ type: 'call', id: 'call-id' }),
    empty: () => true,
    loading: () => false,
    failed: () => false,
    refresh: mocks.refresh,
  };
  const [open, setOpen] = createSignal(false);
  const [focusOnOpen, setFocusOnOpen] = createSignal(false);
  render(() => (
    <CallChat
      access={{ kind: 'member' }}
      callId="call-id"
      open={open()}
      focusOnOpen={focusOnOpen()}
      onClose={() => {}}
    />
  ));
  setOpen(true);
  expect(mocks.focus).not.toHaveBeenCalled();
  setOpen(false);
  setFocusOnOpen(true);
  setOpen(true);
  expect(mocks.focus).toHaveBeenCalledOnce();
});

it('uses the shared thread, guest viewer, and text-only composer for guests', async () => {
  const root: MessageThread['root'] = {
    id: 'call-id',
    parent: { type: 'call', id: 'call-id' },
    sender_id: 'guest-id',
    content: 'Original message',
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    attachments: [],
    mentions: [],
    reactions: [],
  };
  const guestSend = vi.fn().mockResolvedValue(undefined);
  const guestReact = vi.fn().mockResolvedValue(undefined);
  mocks.guestSource = {
    thread: () => ({ root, replies: [] }),
    parent: () => root.parent,
    empty: () => false,
    loading: () => false,
    failed: () => false,
    denied: () => false,
    viewerId: () => 'guest-id',
    refresh: mocks.refresh,
    send: guestSend,
    patch: vi.fn(),
    remove: vi.fn(),
    react: guestReact,
  };
  render(() => (
    <CallChat
      access={{
        kind: 'guest',
        session: { token: 'token', participantId: 'participant' },
      }}
      callId="call-id"
      open
      onClose={() => {}}
    />
  ));
  expect(screen.getByTestId('viewer').textContent).toBe('guest-id');
  expect(mocks.composer?.persistenceKey).toBeUndefined();
  expect(mocks.composer?.features).toEqual({
    mentions: false,
    createItems: false,
    gifs: false,
    richBlocks: false,
    attachments: false,
    dictation: false,
  });
  mocks.snapshot.mockReturnValue({
    value: 'Draft',
    mentions: [],
    attachments: [],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  expect(mocks.restore).toHaveBeenCalledWith(
    expect.objectContaining({
      value: expect.stringContaining('m-reply-target'),
    }),
    { cursor: 'trailing-paragraph' }
  );
  await mocks.composer?.onSend?.({
    value: 'Hello',
    mentions: [],
    attachments: [],
  });
  expect(guestSend).toHaveBeenCalledWith({
    id: 'new-message',
    content: 'Hello',
  });
  fireEvent.click(screen.getByRole('button', { name: 'React' }));
  expect(guestReact).toHaveBeenCalledWith('call-id', '👍', true);
});

it('keeps a failed guest send available to retry with the same id', async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue(undefined);
  mocks.guestSource = {
    thread: () => undefined,
    parent: () => ({ type: 'call', id: 'call-id' }),
    empty: () => true,
    loading: () => false,
    failed: () => false,
    denied: () => false,
    viewerId: () => 'guest-id',
    refresh: mocks.refresh,
    send,
    patch: vi.fn(),
    remove: vi.fn(),
    react: vi.fn(),
  };
  render(() => (
    <CallChat
      access={{
        kind: 'guest',
        session: { token: 'token', participantId: 'participant' },
      }}
      callId="call-id"
      open
      onClose={() => {}}
    />
  ));
  const snapshot = { value: 'Hello', mentions: [], attachments: [] };
  await expect(mocks.composer?.onSend?.(snapshot)).rejects.toThrow('network');
  expect(screen.getByRole('alert').textContent).toContain(
    'Message could not be sent'
  );
  await mocks.composer?.onSend?.(snapshot);
  expect(send.mock.calls).toEqual([
    [{ id: 'new-message', content: 'Hello' }],
    [{ id: 'new-message', content: 'Hello' }],
  ]);
});

it('shows the guest access message and retries loading', () => {
  mocks.guestSource = {
    thread: () => undefined,
    parent: () => ({ type: 'call', id: 'call-id' }),
    empty: () => false,
    loading: () => false,
    failed: () => true,
    denied: () => true,
    viewerId: () => undefined,
    refresh: mocks.refresh,
    send: vi.fn(),
    patch: vi.fn(),
    remove: vi.fn(),
    react: vi.fn(),
  };
  render(() => (
    <CallChat
      access={{
        kind: 'guest',
        session: { token: 'token', participantId: 'participant' },
      }}
      callId="call-id"
      open
      onClose={() => {}}
    />
  ));
  expect(screen.getByRole('alert').textContent).toBe(
    'Chat is available while you are in this call.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('refetches a member thread when its chat panel reopens', () => {
  mocks.refresh.mockResolvedValue(undefined);
  mocks.source = {
    thread: () => undefined,
    parent: () => ({ type: 'call', id: 'call-id' }),
    empty: () => true,
    loading: () => false,
    failed: () => false,
    refresh: mocks.refresh,
  };
  const [open, setOpen] = createSignal(true);
  render(() => (
    <CallChat
      access={{ kind: 'member' }}
      callId="call-id"
      open={open()}
      onClose={() => {}}
    />
  ));
  expect(mocks.refresh).not.toHaveBeenCalled();
  setOpen(false);
  setOpen(true);
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
