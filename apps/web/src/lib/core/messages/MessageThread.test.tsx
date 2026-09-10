import { useMessageActionDrawer } from '@channel/Mobile/message-action-drawer-context';
import type { ThreadProps } from '@channel/Thread/types';
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageThread } from './MessageThread';

const mocks = vi.hoisted(() => ({
  edit: vi.fn(),
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
  createMessageEditor: () => ({ start: mocks.edit }),
}));
vi.mock('@channel/Channel/create-delete-message-confirmation', () => ({
  createDeleteMessageConfirmation: () => ({
    requestDelete: mocks.remove,
    ConfirmationDialog: () => null,
  }),
}));
vi.mock('@queries/messages/mutations', () => ({
  useDeleteMessageMutation: () => ({}),
  useDeleteThreadMutation: () => ({}),
  usePatchMessageMutation: () => ({}),
  usePatchThreadMutation: () => ({}),
}));
vi.mock('@queries/messages/reactions', () => ({
  useAddReactionMutation: () => ({}),
  useRemoveReactionMutation: () => ({}),
}));
vi.mock('@queries/messages/subscription', () => ({}));
vi.mock('@queries/messages/thread-replies', () => ({}));
vi.mock('@queries/messages/timeline', () => ({}));
vi.mock('@channel/Thread/ChannelThread', () => ({
  ChannelThread: (props: ThreadProps) => {
    const drawer = useMessageActionDrawer();
    return (
      <button
        onClick={() =>
          drawer?.open(props.data(), props.getMessageActions?.(props.data()))
        }
      >
        Long press message
      </button>
    );
  },
}));
vi.mock('@channel/Mobile/ActionDrawer', () => ({
  ActionDrawer: () => {
    const drawer = useMessageActionDrawer();
    return (
      <Show when={drawer?.isOpen()}>
        <div role="dialog" aria-label="Message actions">
          <button
            onClick={() =>
              drawer?.actions()?.onEdit?.({ message: drawer.message()! })
            }
          >
            Edit
          </button>
          <button
            onClick={() =>
              drawer?.actions()?.onDelete?.({ message: drawer.message()! })
            }
          >
            Delete
          </button>
          <button
            onClick={() =>
              drawer?.actions()?.onCopyLink?.({ message: drawer.message()! })
            }
          >
            Copy link
          </button>
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
    fireEvent.click(view.getByRole('button', { name: 'Long press message' }));
    expect(view.getByRole('dialog', { name: 'Message actions' })).toBeTruthy();
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
