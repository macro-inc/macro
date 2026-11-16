import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';
import { useOpenEntityNotifications } from '../use-open-entity-notifications';

const mocks = vi.hoisted(() => ({
  graphql: true,
  loading: false,
  createDocumentQuery: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: mocks.graphql && !mocks.loading,
    loading: mocks.loading,
  }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
}));
vi.mock('@queries/notification/graphql/document-notifications', () => ({
  createDocumentNotificationsQuery: mocks.createDocumentQuery,
}));

const notification = (
  id: string,
  state: UnifiedNotification['state'] = 'unseen'
) => ({ id, state }) as UnifiedNotification;

const feedOnly = () => {
  throw new Error('An open document must not read the notification feed');
};

/** A source whose every feed accessor starts the 500-entity feed. */
function graphqlSource(
  overrides: Partial<NotificationSource> = {}
): NotificationSource {
  return {
    notifications: feedOnly,
    notificationsByEntity: feedOnly,
    isLoading: feedOnly,
    get _notificationsQuery(): never {
      return feedOnly();
    },
    withLocalOverrides: (row: UnifiedNotification) => row,
    ...overrides,
  } as unknown as NotificationSource;
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  mocks.graphql = true;
  mocks.loading = false;
  vi.clearAllMocks();
});

function read(
  source: NotificationSource,
  entity: Parameters<typeof useOpenEntityNotifications>[1] = {
    type: 'document',
    id: 'doc',
  }
) {
  return createRoot((cleanup) => {
    dispose = cleanup;
    return useOpenEntityNotifications(source, entity);
  });
}

describe('useOpenEntityNotifications', () => {
  it('reads a document’s own edge with GraphQL Soup, never the feed', () => {
    const [data, setData] = createSignal<UnifiedNotification[] | undefined>();
    mocks.createDocumentQuery.mockReturnValue({
      get data() {
        return data();
      },
    });
    const notifications = read(graphqlSource());

    expect(mocks.createDocumentQuery).toHaveBeenCalledExactlyOnceWith('doc');
    expect(notifications()).toEqual([]);
    setData([notification('a'), notification('b', 'seen')]);
    expect(notifications().map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('reads nothing, and no feed, until the flags say which transport applies', () => {
    mocks.loading = true;
    const notifications = read(graphqlSource());

    expect(notifications()).toEqual([]);
    expect(mocks.createDocumentQuery).not.toHaveBeenCalled();
  });

  it('applies the source’s local seen and done intent to the edge', () => {
    mocks.createDocumentQuery.mockReturnValue({
      data: [notification('a'), notification('b')],
    });
    const notifications = read(
      graphqlSource({
        withLocalOverrides: (row) =>
          row.id === 'a' ? { ...row, state: 'seen' } : row,
      })
    );

    expect(notifications().map(({ state }) => state)).toEqual([
      'seen',
      'unseen',
    ]);
  });

  it('reads the feed with the REST transport', () => {
    mocks.graphql = false;
    const feed = [notification('rest')];
    const notificationsByEntity = vi.fn(() => ({
      'document@doc': feed,
      'document@other': [notification('other')],
    }));
    const notifications = read({
      notificationsByEntity,
    } as unknown as NotificationSource);

    expect(notifications()).toBe(feed);
    expect(mocks.createDocumentQuery).not.toHaveBeenCalled();
  });

  it('reads the feed for an entity without an edge of its own', () => {
    const feed = [notification('chat')];
    const notifications = read(
      graphqlSource({ notificationsByEntity: () => ({ 'chat@chat': feed }) }),
      { type: 'chat', id: 'chat' }
    );

    expect(notifications()).toBe(feed);
    expect(mocks.createDocumentQuery).not.toHaveBeenCalled();
  });
});
