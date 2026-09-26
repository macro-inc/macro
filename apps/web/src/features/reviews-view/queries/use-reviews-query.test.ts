import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import type { GithubPullRequestEntity, Notification } from '@entity';
import { unreadFilterFn } from '@entity/utils/filter';
import type { NotificationSource } from '@notifications/notification-source';
import {
  type SoupAstItemsQuery,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { describe, expect, it, vi } from 'vitest';
import { reviewsQueryBody, useReviewsQuery } from './use-reviews-query';

vi.mock('@components/app/GlobalAppState', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@components/app/GlobalAppState')>()),
  useGlobalNotificationSource: vi.fn(),
}));
vi.mock('@queries/soup/items', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/soup/items')>()),
  useSoupAstItemsQuery: vi.fn(),
}));

// Feature imports can reach websocket clients that cannot connect in jsdom.
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

describe('Reviews Soup filter', () => {
  it.each(['all', 'authored'] as const)(
    'requests accessible GitHub pull requests for %s',
    (scope) => {
      expect(reviewsQueryBody(scope).fef).toEqual({
        l: { fes: 'github_pull_request' },
      });
    }
  );

  it('filters Involving me by the backend participant predicate', () => {
    expect(reviewsQueryBody('involving').fef).toEqual({
      '&': [{ l: { fes: 'github_pull_request' } }, { l: 'me' }],
    });
  });
});

describe('Reviews notifications', () => {
  it('adapts GraphQL item notifications and applies local overrides', () => {
    const notification: Notification = {
      id: 'notification-1',
      entity_id: 'pr-1',
      entity_type: 'foreign_entity',
      notification_event_type: 'github_pr_status_changed',
      notification_metadata: {
        tag: 'github_pr_status_changed',
        content: {
          displayName: 'Review',
          foreignEntityId: 'pr-1',
          githubKey: 'macro/repo/pull/1',
          number: 1,
          owner: 'macro',
          repo: 'repo',
          title: 'Review',
          url: 'https://github.com/macro/repo/pull/1',
          action: 'opened',
          status: 'open',
        },
      },
      sent: true,
      state: 'unseen',
      created_at: '2026-09-11T00:00:00Z',
      updated_at: '2026-09-11T00:00:00Z',
    };
    const review: GithubPullRequestEntity & { notifications: Notification[] } =
      {
        type: 'foreign',
        id: 'pr-1',
        name: 'Review',
        ownerId: 'macro|owner@example.com',
        foreignSource: 'github_pull_request',
        foreignId: 'macro/repo/pull/1',
        storedForId: 'macro|owner@example.com',
        storedForAuthEntity: 'macro',
        metadata: {
          number: 1,
          name: 'Review',
          owner: 'macro',
          repo: 'repo',
          url: 'https://github.com/macro/repo/pull/1',
          status: 'open',
          additions: 0,
          deletions: 0,
          comments: [],
          checks: [],
        },
        notifications: [notification],
      };
    vi.mocked(useGlobalNotificationSource).mockReturnValue({
      notificationsByEntity: () => ({}),
      withLocalOverrides: (item: Notification) => ({
        ...item,
        state: 'seen' as const,
      }),
    } as NotificationSource);
    vi.mocked(useSoupAstItemsQuery).mockReturnValue({
      data: { entities: [review], groups: undefined },
      error: null,
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isFetchingNextPage: false,
      isEnabled: true,
      hasNextPage: false,
      transport: 'graphql',
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      resetToInitialPage: vi.fn(),
      refresh: vi.fn(),
    } satisfies SoupAstItemsQuery);

    const entity = useReviewsQuery(
      () => 'updated_at',
      () => 'involving',
      () => true
    ).reviews()[0];
    if (!entity) throw new Error('Missing review');
    expect(entity.notifications?.()).toEqual([
      { ...notification, state: 'seen' },
    ]);
    expect(unreadFilterFn(entity)).toBe(false);
  });
});
