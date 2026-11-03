import { markPrNotificationsSeenOnOpen } from '@app/features/block-pr/mark-pr-notifications-seen';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import type { GithubPullRequestEntity } from '@entity/types/entity';
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
const notification: UnifiedNotification = {
  id: 'status-changed',
  entity_id: pr.id,
  entity_type: 'foreign_entity',
  state: 'unseen',
  notification_event_type: 'github_pr_status_changed',
  notification_metadata: {
    tag: 'github_pr_status_changed',
    content: {
      action: 'opened',
      displayName: 'example/repo#42',
      foreignEntityId: pr.id,
      githubKey: pr.foreignId,
      number: 42,
      owner: 'example',
      repo: 'repo',
      status: 'open',
      title: pr.name,
      url: pr.metadata.url,
    },
  },
  created_at: '2026-10-23T17:00:00Z',
  updated_at: '2026-10-23T17:00:00Z',
  viewed_at: null,
  sent: true,
};

function createSource() {
  return createRoot((dispose) => ({
    source: createNotificationSource({} as ConnectionGatewayWebsocket),
    dispose,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.transport = 'graphql';
  mocks.feed.mockReturnValue([]);
});

describe('opening pull request notifications', () => {
  it('leaves rows without loaded notifications to the opened PR', () => {
    const { source, dispose } = createSource();
    try {
      markPrNotificationsSeenOnOpen({ ...pr, notifications: [] }, source);
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
        { ...notification, id: `pending-${shape}` },
        { ...notification, id: `done-${shape}`, state: 'done' as const },
        { ...notification, id: `seen-${shape}`, state: 'seen' as const },
      ];
      const fromRestFeed = shape === 'rest-feed';
      if (fromRestFeed) {
        mocks.transport = 'rest';
        mocks.feed.mockReturnValue(attached);
      }
      const { source, dispose } = createSource();
      // REST Soup rows have no raw notification edge; Home reads the source.
      const row = fromRestFeed
        ? pr
        : {
            ...pr,
            notifications: shape === 'array' ? attached : () => attached,
          };
      const rendered = withEntityNotifications(row, source);
      try {
        expect(unreadFilterFn(rendered)).toBe(true);
        markPrNotificationsSeenOnOpen(row, source);
        expect(unreadFilterFn(rendered)).toBe(false);
        expect(mocks.seen).toHaveBeenLastCalledWith({
          notificationIds: [`pending-${shape}`],
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
      const attached = [{ ...notification, id: `failed-read-${transport}` }];
      mocks.feed.mockReturnValue(attached);
      const { source, dispose } = createSource();
      const row = withEntityNotifications(
        transport === 'graphql' ? { ...pr, notifications: attached } : pr,
        source
      );
      try {
        markPrNotificationsSeenOnOpen(row, source);
        expect(unreadFilterFn(row)).toBe(false);
        const error = new Error('offline');
        pending.reject(error);
        await reported.promise;
        expect(telemetry).toHaveBeenCalledWith(error, {
          surface: 'pr-notification-read',
        });
        expect(unreadFilterFn(row)).toBe(true);
        mocks.seen.mockResolvedValueOnce(undefined);
        markPrNotificationsSeenOnOpen(row, source);
        expect(unreadFilterFn(row)).toBe(false);
      } finally {
        dispose();
      }
    }
  );
});
