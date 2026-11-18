vi.mock('@queries/email/read-state', () => ({ markEmailThreadSeen: vi.fn() }));

import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import type { CrmCompanyEntity, CrmContactEntity } from '@entity/types/entity';
import { unreadFilterFn } from '@entity/utils/filter';
import { Telemetry } from '@macro-inc/observability';
import { markRowNotificationsSeenOnOpen } from '@notifications/mark-row-seen';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  seen: vi.fn(),
  entitySeen: vi.fn(),
  feed: vi.fn<() => UnifiedNotification[] | undefined>(() => []),
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_DOCUMENT_MENTION_NOTIFICATIONS: true,
}));
vi.mock('@queries/notification/user-notifications', () => ({
  useMarkNotificationsAsSeenMutation: () => ({ mutateAsync: mocks.seen }),
  useMarkNotificationsAsDoneMutation: () => ({ mutateAsync: vi.fn() }),
  useUserNotificationsQuery: () => ({
    isStarted: false,
    isLoading: false,
    get data() {
      return mocks.feed();
    },
  }),
}));
vi.mock('@queries/notification/notification-soup', () => ({
  updateSoupForNotification: vi.fn(),
}));
vi.mock('@queries/notification/unsubscribes', () => ({
  useMuteItemMutation: () => ({ mutateAsync: vi.fn() }),
  useUnmuteItemMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: vi.fn(),
}));
vi.mock('@service-storage/graphql-notifications', () => ({
  updateNotificationsForEntities: mocks.entitySeen,
}));
vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => undefined,
  isCurrentQueryAccount: () => false,
  queryAccountSessionPending: () => false,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  graphqlCacheEnabled: () => true,
  mapGraphqlNotification: (value: unknown) => value,
}));
vi.mock('@service-storage/graphql-soup-websocket', () => ({
  subscribeToGraphqlNotificationPatches: () => () => {},
}));
vi.mock('../queries/muted-entities-query', () => ({
  createMutedEntitiesQuery: () => ({ isPending: true }),
}));

const COMPANY: CrmCompanyEntity = {
  type: 'crm_company',
  id: 'company',
  name: 'Acme',
  ownerId: 'owner',
  teamId: 'team',
  hidden: false,
  domains: [],
};
const CONTACT: CrmContactEntity = {
  type: 'crm_contact',
  id: 'contact',
  name: 'Example Contact',
  ownerId: 'owner',
  companyId: COMPANY.id,
  email: 'contact@example.com',
  hidden: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.feed.mockImplementation(() => []);
});
afterEach(() => vi.restoreAllMocks());

describe.each([COMPANY, CONTACT])('opening $type notifications', (record) => {
  const discussion: UnifiedNotification = {
    id: 'discussion',
    entity_id: record.id,
    entity_type: record.type,
    state: 'unseen',
    notification_event_type: 'crm_discussion',
    notification_metadata: {
      tag: 'crm_discussion',
      content: {
        messageId: 'message',
        threadId: 'thread',
        reason: 'mention',
        recordName: record.name,
        text: 'Please review',
      },
    },
    created_at: '2026-10-22T17:00:00Z',
    updated_at: '2026-10-22T17:00:00Z',
    viewed_at: null,
    sent: true,
  };
  it('reports a failed entity read when the row has no loaded notifications', async () => {
    const error = new Error('offline');
    const reported = Promise.withResolvers<void>();
    const telemetry = vi
      .spyOn(Telemetry, 'error')
      .mockImplementation(() => reported.resolve());
    mocks.entitySeen.mockRejectedValueOnce(error);
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
      dispose,
    }));
    try {
      markRowNotificationsSeenOnOpen({ ...record, notifications: [] }, source);
      await reported.promise;
      expect(telemetry).toHaveBeenCalledWith(error, {
        surface: 'row-notification-read',
      });
    } finally {
      dispose();
    }
  });

  it.each(['array', 'accessor'] as const)(
    'clears an attached %s before the write finishes without loading the global feed',
    async (shape) => {
      mocks.feed.mockClear();
      const pending = Promise.withResolvers<void>();
      mocks.seen.mockReturnValueOnce(pending.promise);
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource(),
        dispose,
      }));
      const attached = [
        { ...discussion, id: `${record.id}-pending-${shape}` },
        {
          ...discussion,
          id: `${record.id}-done-${shape}`,
          state: 'done' as const,
        },
        {
          ...discussion,
          id: `${record.id}-seen-${shape}`,
          state: 'seen' as const,
        },
      ];
      const row = {
        ...record,
        notifications: shape === 'array' ? attached : () => attached,
      };
      const rendered = withEntityNotifications(row, source);
      try {
        expect(unreadFilterFn(rendered)).toBe(true);
        markRowNotificationsSeenOnOpen(row, source);
        expect(unreadFilterFn(rendered)).toBe(false);
        expect(mocks.seen).toHaveBeenLastCalledWith({
          notificationIds: [`${record.id}-pending-${shape}`],
        });
        expect(mocks.feed).not.toHaveBeenCalled();
        pending.resolve();
        await pending.promise;
        // A stale list snapshot must not resurrect the dot after success.
        expect(unreadFilterFn(withEntityNotifications(row, source))).toBe(
          false
        );
      } finally {
        pending.resolve();
        dispose();
      }
    }
  );

  it('restores the dot after a failed write and clears it on a retry', async () => {
    const pending = Promise.withResolvers<void>();
    const reported = Promise.withResolvers<void>();
    vi.spyOn(Telemetry, 'error').mockImplementation(() => reported.resolve());
    mocks.seen.mockReturnValueOnce(pending.promise);
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
      dispose,
    }));
    const row = withEntityNotifications(
      {
        ...record,
        notifications: [{ ...discussion, id: `${record.id}-failed-read` }],
      },
      source
    );
    try {
      markRowNotificationsSeenOnOpen(row, source);
      expect(unreadFilterFn(row)).toBe(false);
      pending.reject(new Error('offline'));
      await reported.promise;
      expect(unreadFilterFn(row)).toBe(true);
      mocks.seen.mockResolvedValueOnce(undefined);
      markRowNotificationsSeenOnOpen(row, source);
      expect(unreadFilterFn(row)).toBe(false);
    } finally {
      dispose();
    }
  });

  it.each(['absent', 'empty'] as const)(
    'marks the entity with %s row notifications without loading the global feed',
    async (shape) => {
      mocks.entitySeen.mockResolvedValueOnce([]);
      mocks.feed.mockClear();
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource(),
        dispose,
      }));
      try {
        markRowNotificationsSeenOnOpen(
          { ...record, notifications: shape === 'empty' ? [] : undefined },
          source
        );
        expect(mocks.entitySeen).toHaveBeenLastCalledWith({
          entities: [
            {
              entityType:
                record.type === 'crm_company' ? 'CRM_COMPANY' : 'CRM_CONTACT',
              entityId: record.id,
            },
          ],
          operation: 'MARK_SEEN',
          expectedNotificationIds: [],
        });
        expect(mocks.feed).not.toHaveBeenCalled();
      } finally {
        dispose();
      }
    }
  );
});
