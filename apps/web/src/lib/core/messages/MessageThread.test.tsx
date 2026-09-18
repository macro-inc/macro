import { useMessageActionDrawer } from '@channel/Mobile/message-action-drawer-context';
import type { ThreadProps } from '@channel/Thread/types';
import type {
  MessageListItem,
  MessageParent,
  MessageThread as ThreadData,
} from '@service-storage/messages';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { type Accessor, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MessageThread,
  MessageThreadFromSource,
  threadListItem,
} from './MessageThread';

const mocks = vi.hoisted(() => ({
  edit: vi.fn(),
  editor: vi.fn(),
  remove: vi.fn(),
  clipboard: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  byIds: vi.fn(),
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
  usePatchThreadMutation: () => ({}),
}));
vi.mock('@queries/messages/reactions', () => ({
  useAddReactionMutation: () => ({}),
  useRemoveReactionMutation: () => ({}),
}));
vi.mock('@queries/messages/subscription', () => ({
  useMessageSubscription: mocks.subscribe,
}));
vi.mock('@queries/messages/thread-replies', () => ({}));
vi.mock('@queries/messages/timeline', () => ({
  useMessageTimelineByIdsQuery: mocks.byIds,
}));
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

const channel: MessageParent = { type: 'channel', id: 'launch' };
const sourceMessage: MessageListItem = { ...message, parent: channel };

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

describe('source channel threads in a document', () => {
  function renderSource(canWrite: boolean) {
    mocks.byIds.mockReturnValue({ isSuccess: true, data: [sourceMessage] });
    return render(() => (
      <MessageThreadFromSource
        parent={channel}
        rootId="root"
        canWrite={canWrite}
        canManage
      />
    ));
  }

  it('reads, subscribes, and mutates through the source channel and keeps its links', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.clipboard },
    });
    const view = renderSource(true);
    const [subscribed] = mocks.subscribe.mock.calls[0] as [
      Accessor<MessageParent>,
    ];
    expect(subscribed()).toEqual(channel);
    const [parent, ids] = mocks.byIds.mock.calls[0] as [
      Accessor<MessageParent>,
      Accessor<string[]>,
    ];
    expect(parent()).toEqual(channel);
    expect(ids()).toEqual(['root']);
    expect(view.getByText('thread of channel launch')).toBeTruthy();
    expect(
      (
        mocks.editor.mock.calls[0][0] as { parent: Accessor<MessageParent> }
      ).parent()
    ).toEqual(channel);

    openActions(view);
    expect(view.getByRole('button', { name: 'Reply' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Edit' }));
    expect(mocks.edit).toHaveBeenCalledWith(sourceMessage);
    fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    expect(mocks.remove).toHaveBeenCalledWith({
      parent: channel,
      messageID: 'root',
      threadID: undefined,
    });
    fireEvent.click(view.getByRole('button', { name: 'Copy link' }));
    expect(mocks.clipboard).toHaveBeenCalledWith(
      'https://macro.test/app/channel/launch?channel_message_id=root'
    );
    expect(view.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(
      view.queryByRole('button', { name: 'Delete discussion' })
    ).toBeNull();
  });

  it('renders a read-only source thread with no reply, edit, or delete controls', () => {
    const view = renderSource(false);
    expect(view.getByText('thread of channel launch')).toBeTruthy();
    openActions(view);
    expect(view.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(view.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(
      view.queryByRole('button', { name: 'Delete discussion' })
    ).toBeNull();
  });

  it('shows nothing until the source root is readable and hides a root that disappears', () => {
    mocks.byIds.mockReturnValue({ isSuccess: true, data: [] });
    const view = render(() => (
      <MessageThreadFromSource parent={channel} rootId="root" canWrite />
    ));
    expect(view.queryByText('thread of channel launch')).toBeNull();
  });

  it('keeps rendering the cached source root while a refetch fails', () => {
    mocks.byIds.mockReturnValue({
      isPending: false,
      isSuccess: false,
      isError: true,
      data: [sourceMessage],
    });
    const view = render(() => (
      <MessageThreadFromSource parent={channel} rootId="root" canWrite />
    ));
    expect(view.getByText('thread of channel launch')).toBeTruthy();
  });

  it('renders nothing while the source root is still loading', () => {
    mocks.byIds.mockReturnValue({ isPending: true, isSuccess: false });
    const view = render(() => (
      <MessageThreadFromSource parent={channel} rootId="root" canWrite />
    ));
    expect(view.queryByText('thread of channel launch')).toBeNull();
  });

  it('offers a retry when the source root request fails with nothing cached', () => {
    const refetch = vi.fn();
    mocks.byIds.mockReturnValue({
      isPending: false,
      isSuccess: false,
      isError: true,
      data: undefined,
      refetch,
    });
    const view = render(() => (
      <MessageThreadFromSource parent={channel} rootId="root" canWrite />
    ));
    expect(view.queryByText('thread of channel launch')).toBeNull();
    fireEvent.click(
      view.getByRole('button', { name: 'Could not load thread. Retry' })
    );
    expect(refetch).toHaveBeenCalled();
  });
});
