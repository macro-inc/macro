/**
 * @vitest-environment jsdom
 */

import { ok, err } from '@core/util/maybeResult';
import type { GetAllUserNotificationsResponse } from '@service-notification/generated/schemas/getAllUserNotificationsResponse';
import type { UserNotification } from '@service-notification/generated/schemas/userNotification';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import {
  createNotificationSource,
  type NotificationSource,
} from '../notification-source';

vi.mock('@service-notification/client', () => ({
  notificationServiceClient: {
    userNotifications: vi.fn(),
    bulkGetUserNotificationsByEventItemId: vi.fn(),
    bulkMarkNotificationAsSeen: vi.fn(),
    bulkMarkNotificationAsDone: vi.fn(),
    unsubscribeItem: vi.fn(),
    removeUnsubscribeItem: vi.fn(),
  },
  channelMentionMetadata: {},
  documentMentionMetadata: {},
}));

vi.mock('@websocket/index', () => ({
  createSocketEffect: vi.fn(),
}));

vi.mock('../queries/entities-notifications-query', () => ({
  fetchNotificationsForEntities: vi.fn().mockResolvedValue([]),
}));

vi.mock('../queries/muted-entities-query', () => ({
  createMutedEntitiesQuery: vi.fn().mockReturnValue({
    isSuccess: true,
    isLoading: false,
    data: [],
    refetch: vi.fn(),
  }),
}));

import { notificationServiceClient } from '@service-notification/client';

const mockBulkMarkNotificationAsSeen = vi.mocked(
  notificationServiceClient.bulkMarkNotificationAsSeen
);
const mockBulkMarkNotificationAsDone = vi.mocked(
  notificationServiceClient.bulkMarkNotificationAsDone
);
const mockUserNotifications = vi.mocked(
  notificationServiceClient.userNotifications
);

let testQueryClient: QueryClient;

vi.mock('@queries/client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

type UserNotificationsPageParam = { limit: number; cursor?: string };

function createMockNotification(
  overrides: Partial<UserNotification> = {}
): UserNotification {
  return {
    id: `notification-${Math.random().toString(36).slice(2)}`,
    entity_id: 'entity-1',
    entity_type: 'document',
    createdAt: Date.now(),
    updatedAt: null,
    viewedAt: null,
    deletedAt: null,
    done: false,
    sent: true,
    notificationEventType: 'ItemShared',
    notificationMetadata: {
      sharer_id: 'user-1',
      permission_level: 'editor',
    },
    ...overrides,
  } as UserNotification;
}

function createMockWebsocket() {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn(),
  } as unknown as Parameters<typeof createNotificationSource>[0];
}

function createWrapper() {
  return function Wrapper(props: { children: JSX.Element }) {
    return (
      <QueryClientProvider client={testQueryClient}>
        {props.children}
      </QueryClientProvider>
    );
  };
}

function renderWithClient(Component: () => JSX.Element): () => void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Wrapper = createWrapper();
  const dispose = render(
    () => (
      <Wrapper>
        <Component />
      </Wrapper>
    ),
    container
  );
  return () => {
    dispose();
    container.remove();
  };
}

describe('notification-source integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockUserNotifications.mockResolvedValue(
      ok({ items: [], next_cursor: undefined })
    );
  });

  afterEach(() => {
    testQueryClient.clear();
  });

  describe('markAsDone', () => {
    it('should call bulkMarkNotificationAsDone mutation with correct notification id', async () => {
      const n1 = createMockNotification({ id: 'n1' });

      mockBulkMarkNotificationAsDone.mockResolvedValue(ok({ success: true }));

      let notificationSource: NotificationSource | undefined;

      const TestComponent = () => {
        notificationSource = createNotificationSource(createMockWebsocket());
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await new Promise((r) => setTimeout(r, 10));

      await notificationSource!.markAsDone(n1 as any);

      expect(mockBulkMarkNotificationAsDone).toHaveBeenCalledWith({
        notificationIds: ['n1'],
      });

      cleanup();
    });

    it('should propagate errors from the mutation', async () => {
      const n1 = createMockNotification({ id: 'n1' });

      mockBulkMarkNotificationAsDone.mockResolvedValue(
        err('SERVER_ERROR', 'Failed to mark as done')
      );

      let notificationSource: NotificationSource | undefined;

      const TestComponent = () => {
        notificationSource = createNotificationSource(createMockWebsocket());
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await new Promise((r) => setTimeout(r, 10));

      await expect(notificationSource!.markAsDone(n1 as any)).rejects.toThrow();

      cleanup();
    });
  });

  describe('markAsRead', () => {
    it('should call bulkMarkNotificationAsSeen mutation with correct notification id', async () => {
      const n1 = createMockNotification({ id: 'n1', viewedAt: null });

      mockBulkMarkNotificationAsSeen.mockResolvedValue(ok({ success: true }));

      let notificationSource: NotificationSource | undefined;

      const TestComponent = () => {
        notificationSource = createNotificationSource(createMockWebsocket());
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await new Promise((r) => setTimeout(r, 10));

      await notificationSource!.markAsRead(n1 as any);

      expect(mockBulkMarkNotificationAsSeen).toHaveBeenCalledWith({
        notificationIds: ['n1'],
      });

      cleanup();
    });

    it('should propagate errors from the mutation', async () => {
      const n1 = createMockNotification({ id: 'n1', viewedAt: null });

      mockBulkMarkNotificationAsSeen.mockResolvedValue(
        err('NETWORK_ERROR', 'Connection failed')
      );

      let notificationSource: NotificationSource | undefined;

      const TestComponent = () => {
        notificationSource = createNotificationSource(createMockWebsocket());
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await new Promise((r) => setTimeout(r, 10));

      await expect(notificationSource!.markAsRead(n1 as any)).rejects.toThrow();

      cleanup();
    });
  });

  describe('bulkMarkAsDone', () => {
    it('should call bulkMarkNotificationAsDone mutation with multiple notification ids', async () => {
      const n1 = createMockNotification({ id: 'n1' });
      const n2 = createMockNotification({ id: 'n2' });
      const n3 = createMockNotification({ id: 'n3' });

      mockBulkMarkNotificationAsDone.mockResolvedValue(ok({ success: true }));

      let notificationSource: NotificationSource | undefined;

      const TestComponent = () => {
        notificationSource = createNotificationSource(createMockWebsocket());
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await new Promise((r) => setTimeout(r, 10));

      await notificationSource!.bulkMarkAsDone([n1, n2, n3] as any[]);

      expect(mockBulkMarkNotificationAsDone).toHaveBeenCalledWith({
        notificationIds: ['n1', 'n2', 'n3'],
      });

      cleanup();
    });
  });

  describe('bulkMarkAsRead', () => {
    it('should call bulkMarkNotificationAsSeen mutation with multiple notification ids', async () => {
      const n1 = createMockNotification({ id: 'n1', viewedAt: null });
      const n2 = createMockNotification({ id: 'n2', viewedAt: null });
      const n3 = createMockNotification({ id: 'n3', viewedAt: null });

      mockBulkMarkNotificationAsSeen.mockResolvedValue(ok({ success: true }));

      let notificationSource: NotificationSource | undefined;

      const TestComponent = () => {
        notificationSource = createNotificationSource(createMockWebsocket());
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await new Promise((r) => setTimeout(r, 10));

      await notificationSource!.bulkMarkAsRead([n1, n2, n3] as any[]);

      expect(mockBulkMarkNotificationAsSeen).toHaveBeenCalledWith({
        notificationIds: ['n1', 'n2', 'n3'],
      });

      cleanup();
    });
  });
});
