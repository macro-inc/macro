/**
 * @vitest-environment jsdom
 */

import { err, ok } from '@core/util/maybeResult';
import type { UnifiedNotification } from '@notifications/types';
import type { ApiUserNotification } from '@service-notification/generated/schemas/apiUserNotification';
import type { GetAllUserNotificationsResponse } from '@service-notification/generated/schemas/getAllUserNotificationsResponse';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationKeys } from '../keys';
import {
  optimisticInsertNotification,
  useMarkNotificationsAsDoneMutation,
  useMarkNotificationsAsSeenMutation,
} from '../user-notifications';

vi.mock('@service-notification/client', () => ({
  notificationServiceClient: {
    userNotifications: vi.fn(),
    bulkGetUserNotificationsByEventItemId: vi.fn(),
    bulkMarkNotificationAsSeen: vi.fn(),
    bulkMarkNotificationAsDone: vi.fn(),
  },
  channelMentionMetadata: {},
  documentMentionMetadata: {},
}));

import { notificationServiceClient } from '@service-notification/client';

const mockBulkMarkNotificationAsSeen = vi.mocked(
  notificationServiceClient.bulkMarkNotificationAsSeen
);
const mockBulkMarkNotificationAsDone = vi.mocked(
  notificationServiceClient.bulkMarkNotificationAsDone
);

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

type UserNotificationsPageParam = { limit: number; cursor?: string };

function createMockNotification(
  overrides: Partial<UnifiedNotification> = {}
): UnifiedNotification {
  return {
    id: `notification-${Math.random().toString(36).slice(2)}`,
    entity_id: 'entity-1',
    entity_type: 'document',
    created_at: new Date().toISOString(),
    updated_at: null,
    viewed_at: null,
    deleted_at: null,
    done: false,
    sent: true,
    notification_event_type: 'item_shared_user',
    notification_metadata: {
      tag: 'item_shared_user',
      content: {
        sharedBy: 'user-1',
        permissionLevel: 'editor',
      },
    },
    ...overrides,
  } as UnifiedNotification;
}

function createMockNotificationPage(
  notifications: UnifiedNotification[],
  nextCursor?: string
): GetAllUserNotificationsResponse {
  return {
    items: notifications as unknown as ApiUserNotification[],
    next_cursor: nextCursor,
  };
}

function seedQueryCache(pages: GetAllUserNotificationsResponse[], limit = 20) {
  const queryKey = notificationKeys.user({ limit }).queryKey;
  testQueryClient.setQueryData(queryKey, {
    pages,
    pageParams: pages.map((_, i) => ({
      limit,
      cursor: i > 0 ? `cursor-${i}` : undefined,
    })),
  });
  return queryKey;
}

function getNotificationsFromCache(limit = 20) {
  const queryKey = notificationKeys.user({ limit }).queryKey;
  const data = testQueryClient.getQueryData<{
    pages: GetAllUserNotificationsResponse[];
    pageParams: UserNotificationsPageParam[];
  }>(queryKey);
  return data?.pages.flatMap((p) => p.items) ?? [];
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

describe('notification mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    testQueryClient.clear();
  });

  describe('useMarkNotificationsAsSeenMutation', () => {
    it('should optimistically update viewed_at when marking as seen', async () => {
      const n1 = createMockNotification({ id: 'n1', viewed_at: null });
      const n2 = createMockNotification({ id: 'n2', viewed_at: null });
      seedQueryCache([createMockNotificationPage([n1, n2])]);

      mockBulkMarkNotificationAsSeen.mockResolvedValue(ok({ success: true }));

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsSeenMutation();
        mutatePromise = mutation.mutateAsync({ notificationIds: ['n1'] });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      const notifications = getNotificationsFromCache();
      expect(typeof notifications[0].viewed_at).toBe('string');
      expect(notifications[1].viewed_at).toBe(null);

      cleanup();
    });

    it('should rollback optimistic update on error', async () => {
      const n1 = createMockNotification({ id: 'n1', viewed_at: null });
      seedQueryCache([createMockNotificationPage([n1])]);

      mockBulkMarkNotificationAsSeen.mockResolvedValue(
        err('SERVER_ERROR', 'Failed to mark as seen')
      );

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsSeenMutation();
        mutatePromise = mutation
          .mutateAsync({ notificationIds: ['n1'] })
          .catch(() => {});
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;
      // Wait for rollback to complete
      await new Promise((r) => setTimeout(r, 10));

      const notifications = getNotificationsFromCache();
      expect(notifications[0].viewed_at).toBe(null);

      cleanup();
    });

    it('should handle marking notifications across multiple pages', async () => {
      const n1 = createMockNotification({ id: 'n1', viewed_at: null });
      const n2 = createMockNotification({ id: 'n2', viewed_at: null });
      seedQueryCache([
        createMockNotificationPage([n1]),
        createMockNotificationPage([n2]),
      ]);

      mockBulkMarkNotificationAsSeen.mockResolvedValue(ok({ success: true }));

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsSeenMutation();
        mutatePromise = mutation.mutateAsync({ notificationIds: ['n2'] });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      const notifications = getNotificationsFromCache();
      expect(notifications[0].viewed_at).toBe(null); // n1 unchanged
      expect(typeof notifications[1].viewed_at).toBe('string'); // n2 updated

      cleanup();
    });
  });

  describe('useMarkNotificationsAsDoneMutation', () => {
    it('should optimistically remove notifications when marking as done', async () => {
      const n1 = createMockNotification({ id: 'n1' });
      const n2 = createMockNotification({ id: 'n2' });
      const n3 = createMockNotification({ id: 'n3' });
      seedQueryCache([createMockNotificationPage([n1, n2, n3])]);

      mockBulkMarkNotificationAsDone.mockResolvedValue(ok({ success: true }));

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsDoneMutation();
        mutatePromise = mutation.mutateAsync({ notificationIds: ['n1', 'n3'] });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      const notifications = getNotificationsFromCache();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].id).toBe('n2');

      cleanup();
    });

    it('should rollback optimistic removal on error', async () => {
      const n1 = createMockNotification({ id: 'n1' });
      const n2 = createMockNotification({ id: 'n2' });
      seedQueryCache([createMockNotificationPage([n1, n2])]);

      mockBulkMarkNotificationAsDone.mockResolvedValue(
        err('NETWORK_ERROR', 'Connection failed')
      );

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsDoneMutation();
        mutatePromise = mutation
          .mutateAsync({ notificationIds: ['n1'] })
          .catch(() => {});
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;
      // Wait for rollback to complete
      await new Promise((r) => setTimeout(r, 10));

      const notifications = getNotificationsFromCache();
      expect(notifications).toHaveLength(2);
      expect(notifications.find((n) => n.id === 'n1')).toBeDefined();

      cleanup();
    });

    it('should handle removing notifications across multiple pages', async () => {
      const n1 = createMockNotification({ id: 'n1' });
      const n2 = createMockNotification({ id: 'n2' });
      const n3 = createMockNotification({ id: 'n3' });
      seedQueryCache([
        createMockNotificationPage([n1, n2]),
        createMockNotificationPage([n3]),
      ]);

      mockBulkMarkNotificationAsDone.mockResolvedValue(ok({ success: true }));

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsDoneMutation();
        mutatePromise = mutation.mutateAsync({ notificationIds: ['n2', 'n3'] });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      const notifications = getNotificationsFromCache();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].id).toBe('n1');

      cleanup();
    });
  });
});

describe('optimisticInsertNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    testQueryClient.clear();
  });

  it('should insert notification at the beginning of the first page', () => {
    const n1 = createMockNotification({ id: 'n1' });
    const n2 = createMockNotification({ id: 'n2' });
    seedQueryCache([createMockNotificationPage([n1, n2])]);

    const newNotification = createMockNotification({ id: 'new-notification' });
    optimisticInsertNotification(newNotification);

    const notifications = getNotificationsFromCache();
    expect(notifications).toHaveLength(3);
    expect(notifications[0].id).toBe('new-notification');
    expect(notifications[1].id).toBe('n1');
    expect(notifications[2].id).toBe('n2');
  });

  it('should not insert duplicate notifications', () => {
    const n1 = createMockNotification({ id: 'n1' });
    const n2 = createMockNotification({ id: 'n2' });
    seedQueryCache([createMockNotificationPage([n1, n2])]);

    const duplicateNotification = createMockNotification({ id: 'n1' });
    optimisticInsertNotification(duplicateNotification);

    const notifications = getNotificationsFromCache();
    expect(notifications).toHaveLength(2);
    expect(notifications[0].id).toBe('n1');
    expect(notifications[1].id).toBe('n2');
  });
});
