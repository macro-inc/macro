import type { EmailEntity } from '@entity/types/entity';
import type { UnifiedNotification } from '@notifications/types';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSidebarUnread } from './use-sidebar-unread';

const mocks = vi.hoisted(() => ({
  inbox: vi.fn(),
  email: vi.fn(),
  notifications: vi.fn(),
}));

vi.mock('@app/features/inbox-view/queries/use-inbox-query', () => ({
  useInboxEntitiesQuery: mocks.inbox,
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: mocks.email,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ notifications: mocks.notifications }),
}));
// Query builders import the soup barrel, which otherwise opens real sockets.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const unreadEmail: EmailEntity = {
  id: 'email',
  type: 'email',
  name: 'Important email',
  ownerId: 'user',
  isRead: false,
  isDraft: false,
  isImportant: true,
  done: false,
};

const message: UnifiedNotification = {
  id: 'notification',
  entity_id: 'channel',
  entity_type: 'channel',
  created_at: '2026-09-10T12:00:00Z',
  updated_at: '2026-09-10T12:00:00Z',
  state: 'unseen',
  sent: true,
  viewed_at: null,
  notification_event_type: 'channel_message_send',
  notification_metadata: {
    tag: 'channel_message_send',
    content: { channelType: 'directMessage', messageId: 'message' },
  },
};

let dispose: VoidFunction;
afterEach(() => {
  dispose?.();
  vi.clearAllMocks();
});

function setup() {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [loading, setLoading] = createSignal(true);
    const [emails, setEmails] = createSignal<EmailEntity[]>([]);
    const [notifications, setNotifications] = createSignal<
      UnifiedNotification[]
    >([]);
    const query = {
      get isLoading() {
        return loading();
      },
      get data() {
        if (loading()) throw new Error('Read pending resource');
        return { entities: emails() };
      },
    };
    mocks.inbox.mockReturnValue({
      query,
      transformEntities: (items: EmailEntity[]) =>
        items.filter((item) => !item.done),
    });
    mocks.email.mockReturnValue(query);
    mocks.notifications.mockImplementation(notifications);
    return {
      unread: useSidebarUnread(),
      setLoading,
      setEmails,
      setNotifications,
    };
  });
}

describe('sidebar unread presence', () => {
  it('does not read pending resources or badge unrelated navigation', () => {
    const { unread } = setup();
    for (const id of ['inbox', 'mail', 'channels', 'documents', 'agents']) {
      expect(unread(id)).toBe(false);
    }
    expect(mocks.inbox).toHaveBeenCalledWith({
      tab: 'signal',
      facets: { read: ['unread'] },
    });
  });

  it('reacts to read, unread, and done changes in loaded rows', () => {
    const { unread, setLoading, setEmails } = setup();
    setLoading(false);
    setEmails([unreadEmail]);
    expect(unread('inbox')).toBe(true);
    expect(unread('mail')).toBe(true);
    setEmails([{ ...unreadEmail, isRead: true }]);
    expect(unread('inbox')).toBe(false);
    expect(unread('mail')).toBe(false);
    setEmails([unreadEmail]);
    expect(unread('mail')).toBe(true);
    setEmails([{ ...unreadEmail, done: true }]);
    expect(unread('inbox')).toBe(false);
    expect(unread('mail')).toBe(false);
  });

  it('uses unread channel messages, ignoring seen, completed, and other entities', () => {
    const { unread, setNotifications } = setup();
    setNotifications([message]);
    expect(unread('channels')).toBe(true);
    setNotifications([
      { ...message, state: 'seen', viewed_at: message.created_at },
    ]);
    expect(unread('channels')).toBe(false);
    setNotifications([{ ...message, state: 'done' }]);
    expect(unread('channels')).toBe(false);
    setNotifications([{ ...message, entity_type: 'document' }]);
    expect(unread('channels')).toBe(false);
    setNotifications([message, { ...message, id: 'another' }]);
    expect(unread('channels')).toBe(true);
    setNotifications([]);
    expect(unread('channels')).toBe(false);
  });
});
