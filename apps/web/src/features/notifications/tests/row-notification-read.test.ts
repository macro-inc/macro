vi.mock('@queries/email/read-state', () => ({
  markEmailThreadSeen: mocks.emailSeen,
}));

import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import type { EntityData, GithubPullRequestEntity } from '@entity/types/entity';
import { unreadFilterFn } from '@entity/utils/filter';
import { Telemetry } from '@macro-inc/observability';
import { markRowNotificationsSeenOnOpen } from '@notifications/mark-row-seen';
import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  seen: vi.fn(),
  emailSeen: vi.fn(async () => {}),
  entitySeen: vi.fn(),
  feed: vi.fn<() => UnifiedNotification[]>(() => []),
  transport: 'graphql' as 'graphql' | 'rest',
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
    get transport() {
      return mocks.transport;
    },
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
    type: 'foreign_entity',
    id: 'pull-request',
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

const pr: GithubPullRequestEntity = {
  type: 'foreign',
  id: 'pull-request',
  ownerId: 'owner',
  name: 'Fix flaky test',
  foreignId: 'example/repo/pull/42',
  storedForId: 'team',
  storedForAuthEntity: 'team',
  foreignSource: 'github_pull_request',
  metadata: {
    number: 42,
    name: 'Fix flaky test',
    owner: 'example',
    repo: 'repo',
    url: 'https://github.com/example/repo/pull/42',
    status: 'open',
    additions: 1,
    deletions: 1,
    comments: [],
    checks: [],
    labels: [],
  },
};
function createSource() {
  return createRoot((dispose) => ({
    source: createNotificationSource({} as ConnectionGatewayWebsocket),
    dispose,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.seen.mockReset();
  mocks.emailSeen.mockReset();
  mocks.entitySeen.mockClear();
  mocks.transport = 'graphql';
  mocks.feed.mockReturnValue([]);
});

const rows = [
  pr,
  {
    type: 'document',
    id: 'markdown',
    name: 'Note',
    ownerId: 'owner',
    fileType: 'md',
  },
  {
    type: 'document',
    id: 'task',
    name: 'Task',
    ownerId: 'owner',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
  },
  { type: 'chat', id: 'chat', name: 'Legacy chat', ownerId: 'owner' },
  {
    type: 'email',
    id: 'thread',
    name: 'Email',
    ownerId: 'owner',
    isRead: true,
    isDraft: false,
    isImportant: false,
    done: false,
  },
] satisfies EntityData[];

describe.each(rows)('opening $type ($id) notifications', (entity) => {
  const notification: UnifiedNotification = {
    id: `${entity.id}-reminder`,
    entity_id: entity.id,
    entity_type:
      entity.type === 'email'
        ? 'email_thread'
        : entity.type === 'foreign'
          ? 'foreign_entity'
          : entity.type,
    state: 'unseen',
    notification_event_type: 'reminder',
    notification_metadata: {
      tag: 'reminder',
      content: { reminderId: 'reminder', description: 'Follow up' },
    },
    created_at: '2026-10-23T17:00:00Z',
    updated_at: '2026-10-23T17:00:00Z',
    viewed_at: null,
    sent: true,
  };
  it('leaves rows without loaded notifications to the opened detail', () => {
    const { source, dispose } = createSource();
    try {
      markRowNotificationsSeenOnOpen({ ...entity, notifications: [] }, source);
      expect(mocks.seen).not.toHaveBeenCalled();
      expect(mocks.entitySeen).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it.each(['array', 'accessor', 'rest-feed'] as const)(
    'clears %s notifications before the write finishes',
    async (shape) => {
      mocks.feed.mockClear();
      const pending = Promise.withResolvers<void>();
      mocks.seen.mockReturnValueOnce(pending.promise);
      const attached = [
        { ...notification, id: `${entity.id}-pending-${shape}` },
        {
          ...notification,
          id: `${entity.id}-done-${shape}`,
          state: 'done' as const,
        },
        {
          ...notification,
          id: `${entity.id}-seen-${shape}`,
          state: 'seen' as const,
        },
      ];
      const fromRestFeed = shape === 'rest-feed';
      if (fromRestFeed) {
        mocks.transport = 'rest';
        mocks.feed.mockReturnValue(attached);
      }
      const { source, dispose } = createSource();
      // REST Soup rows have no raw notification edge; Home reads the source.
      const row = fromRestFeed
        ? entity
        : {
            ...entity,
            notifications: shape === 'array' ? attached : () => attached,
          };
      const rendered = withEntityNotifications(row, source);
      try {
        expect(unreadFilterFn(rendered)).toBe(true);
        markRowNotificationsSeenOnOpen(row, source);
        expect(unreadFilterFn(rendered)).toBe(false);
        expect(mocks.seen).toHaveBeenLastCalledWith({
          notificationIds: [`${entity.id}-pending-${shape}`],
        });
        if (!fromRestFeed) expect(mocks.feed).not.toHaveBeenCalled();
        pending.resolve();
        await pending.promise;
        expect(unreadFilterFn(withEntityNotifications(row, source))).toBe(
          false
        );
      } finally {
        pending.resolve();
        dispose();
      }
    }
  );

  it.each(['graphql', 'rest'] as const)(
    'restores the %s dot after a failed write and clears it on a retry',
    async (transport) => {
      const pending = Promise.withResolvers<void>();
      const reported = Promise.withResolvers<void>();
      const telemetry = vi
        .spyOn(Telemetry, 'error')
        .mockImplementation(() => reported.resolve());
      mocks.seen.mockReturnValueOnce(pending.promise);
      mocks.transport = transport;
      const attached = [
        { ...notification, id: `${entity.id}-failed-read-${transport}` },
      ];
      mocks.feed.mockReturnValue(attached);
      const { source, dispose } = createSource();
      const row = withEntityNotifications(
        transport === 'graphql'
          ? { ...entity, notifications: attached }
          : entity,
        source
      );
      try {
        markRowNotificationsSeenOnOpen(row, source);
        expect(unreadFilterFn(row)).toBe(false);
        const error = new Error('offline');
        pending.reject(error);
        await reported.promise;
        expect(telemetry).toHaveBeenCalledWith(error, {
          surface: 'row-notification-read',
        });
        expect(unreadFilterFn(row)).toBe(true);
        mocks.seen.mockResolvedValueOnce(undefined);
        markRowNotificationsSeenOnOpen(row, source);
        expect(unreadFilterFn(row)).toBe(false);
      } finally {
        dispose();
      }
    }
  );
});

it('marks an unread email with a draft reply in its owning inbox without waiting for notifications', () => {
  const { source, dispose } = createSource();
  try {
    markRowNotificationsSeenOnOpen(
      {
        type: 'email',
        id: 'unread-thread',
        ownerId: 'owner',
        name: 'Email',
        isRead: false,
        isDraft: true,
        isImportant: false,
        done: false,
        linkId: 'secondary-inbox',
        notifications: [],
      },
      source
    );
    expect(mocks.emailSeen).toHaveBeenCalledExactlyOnceWith({
      threadId: 'unread-thread',
      linkId: 'secondary-inbox',
    });
    expect(mocks.seen).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});
