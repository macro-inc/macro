import { markCalendarNotificationSeenOnOpen } from '@app/features/calendar/mark-event-notifications-seen';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import type { CalendarEventEntity } from '@entity/types/entity';
import { unreadFilterFn } from '@entity/utils/filter';
import { Telemetry } from '@macro-inc/observability';
import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  seen: vi.fn(),
  entitySeen: vi.fn(),
  feed: vi.fn(() => []),
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_DOCUMENT_MENTION_NOTIFICATIONS: true,
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => true,
}));
vi.mock('@macro-inc/collaboration/websocket', () => ({
  createSocketEffect: vi.fn(),
}));
vi.mock('@queries/notification/user-notifications', () => ({
  optimisticInsertNotification: vi.fn(),
  useMarkNotificationsAsSeenMutation: () => ({ mutateAsync: mocks.seen }),
  useMarkNotificationsAsDoneMutation: () => ({ mutateAsync: vi.fn() }),
  useUserNotificationsQuery: () => ({
    transport: 'graphql',
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
vi.mock('@queries/notification/entity-mutations', () => ({
  toNotificationEntityRef: vi.fn(() => ({
    type: 'calendar_event',
    id: 'event',
  })),
  updateNotificationsForEntities: mocks.entitySeen,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  mapGraphqlNotification: (value: unknown) => value,
}));
vi.mock('@service-storage/graphql-soup-websocket', () => ({
  subscribeToGraphqlNotificationPatches: () => () => {},
}));
vi.mock('../queries/muted-entities-query', () => ({
  createMutedEntitiesQuery: () => ({ isPending: true }),
}));

const event: CalendarEventEntity = {
  type: 'calendar_event',
  id: 'event',
  name: 'Prod Deploy',
  ownerId: 'owner',
  status: 'confirmed',
  isReadOnly: false,
};
const reminder: UnifiedNotification = {
  id: 'reminder',
  entity_id: event.id,
  entity_type: 'calendar_event',
  state: 'unseen',
  notification_event_type: 'calendar_event_reminder',
  notification_metadata: {
    tag: 'calendar_event_reminder',
    content: {
      eventId: event.id,
      title: event.name,
      startsAt: '2026-10-22T18:00:00Z',
      endsAt: '2026-10-22T18:30:00Z',
      occurrenceKey: '2026-10-22T18:00:00Z',
      minutesBefore: 60,
    },
  },
  created_at: '2026-10-22T17:00:00Z',
  updated_at: '2026-10-22T17:00:00Z',
  viewed_at: null,
  sent: true,
};

afterEach(() => vi.restoreAllMocks());

describe('opening calendar notifications', () => {
  it('reports a failed entity read when the row has no loaded notifications', async () => {
    const error = new Error('offline');
    const reported = Promise.withResolvers<void>();
    const telemetry = vi
      .spyOn(Telemetry, 'error')
      .mockImplementation(() => reported.resolve());
    mocks.entitySeen.mockRejectedValueOnce(error);
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource({} as ConnectionGatewayWebsocket),
      dispose,
    }));
    try {
      markCalendarNotificationSeenOnOpen(
        { ...event, notifications: [] },
        source
      );
      await reported.promise;
      expect(telemetry).toHaveBeenCalledWith(error, {
        surface: 'calendar-notification-read',
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
        source: createNotificationSource({} as ConnectionGatewayWebsocket),
        dispose,
      }));
      const attached = [
        { ...reminder, id: `pending-${shape}` },
        { ...reminder, id: `done-${shape}`, state: 'done' as const },
        { ...reminder, id: `seen-${shape}`, state: 'seen' as const },
      ];
      const row = {
        ...event,
        notifications: shape === 'array' ? attached : () => attached,
      };
      const rendered = withEntityNotifications(row, source);
      try {
        expect(unreadFilterFn(rendered)).toBe(true);
        markCalendarNotificationSeenOnOpen(row, source);
        expect(unreadFilterFn(rendered)).toBe(false);
        expect(mocks.seen).toHaveBeenLastCalledWith({
          notificationIds: [`pending-${shape}`],
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
      source: createNotificationSource({} as ConnectionGatewayWebsocket),
      dispose,
    }));
    const row = withEntityNotifications(
      { ...event, notifications: [{ ...reminder, id: 'failed-read' }] },
      source
    );
    try {
      markCalendarNotificationSeenOnOpen(row, source);
      expect(unreadFilterFn(row)).toBe(false);
      pending.reject(new Error('offline'));
      await reported.promise;
      expect(unreadFilterFn(row)).toBe(true);
      mocks.seen.mockResolvedValueOnce(undefined);
      markCalendarNotificationSeenOnOpen(row, source);
      expect(unreadFilterFn(row)).toBe(false);
    } finally {
      dispose();
    }
  });
});
