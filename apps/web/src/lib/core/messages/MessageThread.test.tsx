import { useMessageActionDrawer } from '@channel/Mobile/message-action-drawer-context';
import type { ThreadProps } from '@channel/Thread/types';
import type {
  MessageListItem,
  MessageThread as ThreadData,
} from '@service-storage/messages';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageThread, threadListItem } from './MessageThread';

const mocks = vi.hoisted(() => ({
  edit: vi.fn(),
  editor: vi.fn(),
  remove: vi.fn(),
  clipboard: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [() => {}, 'scope'],
}));
vi.mock('@channel/Channel/create-message-editor', () => ({
  createMessageEditor: (options: unknown) => {
    mocks.editor(options);
    return { start: mocks.edit };
  },
}));
vi.mock('@channel/Channel/create-delete-message-confirmation', () => ({
  createDeleteMessageConfirmation: () => ({
    requestDelete: mocks.remove,
    ConfirmationDialog: () => null,
  }),
}));
vi.mock('@channel/Thread/utils/message-actions', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@channel/Thread/utils/message-actions')
  >()),
  buildMessageLink: (channelId: string, messageId: string) =>
    `https://macro.test/app/channel/${channelId}?channel_message_id=${messageId}`,
}));
vi.mock('@queries/messages/mutations', () => ({
  useDeleteMessageMutation: () => ({}),
  useDeleteThreadMutation: () => ({}),
  usePatchMessageMutation: () => ({}),
}));
vi.mock('@queries/messages/reactions', () => ({
  useAddReactionMutation: () => ({}),
  useRemoveReactionMutation: () => ({}),
}));
vi.mock('@queries/messages/thread-replies', () => ({}));
vi.mock('@channel/Thread/ChannelThread', () => ({
  ChannelThread: (props: ThreadProps) => {
    const drawer = useMessageActionDrawer();
    return (
      <>
        <p>
          thread of {props.parent().type} {props.parent().id}
        </p>
        <button
          onClick={() =>
            drawer?.open(props.data(), props.getMessageActions?.(props.data()))
          }
        >
          Long press message
        </button>
      </>
    );
  },
}));
vi.mock('@channel/Mobile/ActionDrawer', () => ({
  ActionDrawer: () => {
    const drawer = useMessageActionDrawer();
    const action = (name: 'onReply' | 'onEdit' | 'onDelete' | 'onCopyLink') =>
      drawer?.actions()?.[name];
    const button = (
      label: string,
      name: 'onReply' | 'onEdit' | 'onDelete' | 'onCopyLink'
    ) => (
      <Show when={action(name)}>
        <button onClick={() => action(name)?.({ message: drawer!.message()! })}>
          {label}
        </button>
      </Show>
    );
    return (
      <Show when={drawer?.isOpen()}>
        <div role="dialog" aria-label="Message actions">
          {button('Reply', 'onReply')}
          {button('Edit', 'onEdit')}
          {button('Delete', 'onDelete')}
          {button('Copy link', 'onCopyLink')}
        </div>
      </Show>
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const message: MessageListItem = {
  id: 'root',
  parent: { type: 'document', id: 'document' },
  sender_id: 'user',
  content: 'Comment',
  mentions: [],
  attachments: [],
  reactions: [],
  created_at: '2026-09-09T00:00:00Z',
  updated_at: '2026-09-09T00:00:00Z',
  state: {
    root_id: 'root',
    user_id: 'user',
    anchor: null,
    resolved: false,
    created_at: '2026-09-09T00:00:00Z',
    updated_at: '2026-09-09T00:00:00Z',
  },
  thread: { reply_count: 0, preview: [] },
};

function openActions(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole('button', { name: 'Long press message' }));
  return view.getByRole('dialog', { name: 'Message actions' });
}

describe('document message touch actions', () => {
  it('provides edit, delete, and copy-link actions outside a channel', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.clipboard },
    });
    const editing = vi.fn();
    const view = render(() => (
      <MessageThread
        data={message}
        canWrite
        onEditingChange={editing}
        buildLink={(item) =>
          `https://macro.test/app/md/document?comment_id=${item.id}`
        }
      />
    ));
    openActions(view);
    fireEvent.click(view.getByRole('button', { name: 'Edit' }));
    expect(mocks.edit).toHaveBeenCalledWith(message);
    expect(editing).toHaveBeenCalledWith('root', true);
    fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    expect(mocks.remove).toHaveBeenCalledWith({
      parent: message.parent,
      messageID: 'root',
      threadID: undefined,
    });
    fireEvent.click(view.getByRole('button', { name: 'Copy link' }));
    expect(mocks.clipboard).toHaveBeenCalledWith(
      'https://macro.test/app/md/document?comment_id=root'
    );
  });
});

describe('document discussion controls', () => {
  // A document thread carries no thread-level controls of its own: resolve was
  // dead, and deleting a discussion is moving onto the root message's delete.
  it('renders no resolve or delete-discussion control', () => {
    const view = render(() => <MessageThread data={message} canWrite />);
    expect(view.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(
      view.queryByRole('button', { name: 'Delete discussion' })
    ).toBeNull();
  });
});

describe('threadListItem', () => {
  const reply = (id: string, createdAt: string) =>
    ({
      id,
      parent: { type: 'document', id: 'doc' },
      sender_id: 'user',
      content: id,
      created_at: createdAt,
      updated_at: createdAt,
      mentions: [],
      attachments: [],
      reactions: [],
    }) as unknown as MessageListItem;

  it('previews the latest three replies, newest last, as channels do', () => {
    const replies = [
      reply('r1', '2026-01-01T00:00:00Z'),
      reply('r2', '2026-01-02T00:00:00Z'),
      reply('r3', '2026-01-03T00:00:00Z'),
      reply('r4', '2026-01-04T00:00:00Z'),
      reply('r5', '2026-01-05T00:00:00Z'),
    ];
    const item = threadListItem({
      root: reply('root', '2026-01-01T00:00:00Z'),
      state: { root_id: 'root' },
      replies,
    } as unknown as ThreadData);
    expect(item.thread.reply_count).toBe(5);
    expect(item.thread.preview.map((r) => r.id)).toEqual(['r3', 'r4', 'r5']);
    expect(item.thread.latest_reply_at).toBe('2026-01-05T00:00:00Z');
  });
});
