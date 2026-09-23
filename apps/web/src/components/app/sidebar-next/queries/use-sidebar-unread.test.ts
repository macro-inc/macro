import type { EmailEntity } from '@entity/types/entity';
import type { UnifiedNotification } from '@notifications/types';
import type { NotificationState } from '@service-storage/graphql/generated/graphql';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSidebarUnread } from './use-sidebar-unread';

const mocks = vi.hoisted(() => ({
  inbox: vi.fn(),
  email: vi.fn(),
  notifications: vi.fn(),
  graphqlFlag: vi.fn(),
  channels: vi.fn(),
  withLocalState: vi.fn(),
  hasUnreadEntity: vi.fn(),
  transformEntities: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => mocks.graphqlFlag,
}));
vi.mock('@queries/channel/unread-presence', () => ({
  createChannelUnreadQuery: mocks.channels,
}));

vi.mock('@app/features/email-view/queries/email-query', () => ({
  buildEmailQuery: () => ({ params: {}, body: {} }),
}));
vi.mock('@app/features/inbox-view/queries/use-inbox-query', () => ({
  useInboxEntitiesQuery: mocks.inbox,
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: mocks.email,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({
    notifications: mocks.notifications,
    withLocalState: mocks.withLocalState,
  }),
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

function setup(graphql = false) {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [graphqlEnabled, setGraphqlEnabled] = createSignal(graphql);
    const [done, setDone] = createSignal(false);
    mocks.withLocalState.mockImplementation(({ state }) =>
      done() ? 'done' : state
    );
    const [witnesses, setWitnesses] = createSignal<
      { id: string; state: NotificationState }[]
    >([]);
    mocks.graphqlFlag.mockImplementation(() => ({ enabled: graphqlEnabled() }));
    const [loading, setLoading] = createSignal(true);
    mocks.channels.mockReturnValue({
      get isEnabled() {
        return graphqlEnabled();
      },
      get isLoading() {
        return loading();
      },
      get data() {
        if (loading()) throw new Error('Read pending unread query');
        return witnesses();
      },
    });
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
    mocks.hasUnreadEntity.mockImplementation((items: EmailEntity[]) =>
      items.some((item) => !item.done && !item.isRead)
    );
    mocks.inbox.mockReturnValue({
      query,
      hasUnreadEntity: mocks.hasUnreadEntity,
      transformEntities: mocks.transformEntities,
    });
    mocks.email.mockReturnValue(query);
    mocks.notifications.mockImplementation(notifications);
    return {
      unread: useSidebarUnread(),
      setLoading,
      setEmails,
      setNotifications,
      setWitnesses,
      setGraphqlEnabled,
      setDone,
    };
  });
}

describe('sidebar unread presence', () => {
  it('does not read pending resources or badge unrelated navigation', () => {
    const { unread } = setup();
    for (const id of ['inbox', 'mail', 'channels', 'documents', 'agents']) {
      expect(unread(id)).toBe(false);
    }
    expect(mocks.hasUnreadEntity).not.toHaveBeenCalled();
    expect(mocks.transformEntities).not.toHaveBeenCalled();
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
    expect(mocks.hasUnreadEntity).toHaveBeenLastCalledWith([unreadEmail]);
    expect(mocks.transformEntities).not.toHaveBeenCalled();
    setEmails([{ ...unreadEmail, isRead: true }]);
    expect(unread('inbox')).toBe(false);
    expect(unread('mail')).toBe(false);
    setEmails([unreadEmail]);
    expect(unread('mail')).toBe(true);
    setEmails([{ ...unreadEmail, done: true }]);
    expect(unread('inbox')).toBe(false);
    expect(unread('mail')).toBe(false);
  });

  it('uses bounded GraphQL witnesses without reading the full feed', () => {
    const { unread, setLoading, setWitnesses, setDone } = setup(true);
    expect(unread('channels')).toBe(false);
    expect(mocks.notifications).not.toHaveBeenCalled();
    expect(mocks.channels.mock.calls[0][0]).toMatchObject({
      initial: {
        limit: 500,
        filters: {
          channelFilter: { literal: { notificationState: 'UNSEEN' } },
        },
      },
    });
    setLoading(false);
    setWitnesses([{ id: 'witness', state: 'UNSEEN' }]);
    expect(unread('channels')).toBe(true);
    setDone(true);
    expect(unread('channels')).toBe(false);
    setDone(false);
    expect(unread('channels')).toBe(true);
    setWitnesses([{ id: 'witness', state: 'SEEN' }]);
    expect(unread('channels')).toBe(false);
    setWitnesses([]);
    expect(unread('channels')).toBe(false);
    expect(mocks.notifications).not.toHaveBeenCalled();
  });

  it('follows cold-start transport changes without reading the inactive feed', () => {
    const {
      unread,
      setLoading,
      setGraphqlEnabled,
      setWitnesses,
      setNotifications,
    } = setup();
    setLoading(false);
    setNotifications([message]);
    expect(unread('channels')).toBe(true);
    mocks.notifications.mockClear();
    setGraphqlEnabled(true);
    expect(unread('channels')).toBe(false);
    setWitnesses([{ id: 'bounded', state: 'UNSEEN' }]);
    expect(unread('channels')).toBe(true);
    expect(mocks.notifications).not.toHaveBeenCalled();
    setNotifications([]);
    setGraphqlEnabled(false);
    expect(unread('channels')).toBe(false);
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
