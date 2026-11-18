import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';
import { useOpenEntityNotifications } from '../use-open-entity-notifications';

const mocks = vi.hoisted(() => ({
  createDocumentQuery: vi.fn(),
}));
vi.mock('@queries/notification/graphql/document-notifications', () => ({
  useDocumentNotificationsQuery: mocks.createDocumentQuery,
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
    isEnabled: () => true,
    withLocalOverrides: (row: UnifiedNotification) => row,
    ...overrides,
  } as unknown as NotificationSource;
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
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
  it('reads a document’s own edge , never the feed', () => {
    const [data, setData] = createSignal<UnifiedNotification[] | undefined>();
    mocks.createDocumentQuery.mockReturnValue({
      get data() {
        return data();
      },
    });
    const source = graphqlSource();
    const notifications = read(source);

    expect(mocks.createDocumentQuery).toHaveBeenCalledExactlyOnceWith(
      'doc',
      source.isEnabled
    );
    expect(notifications()).toEqual([]);
    setData([notification('a'), notification('b', 'seen')]);
    expect(notifications().map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('shows nothing from the edge while the session cannot read notifications', () => {
    const [enabled, setEnabled] = createSignal(false);
    mocks.createDocumentQuery.mockReturnValue({ data: [notification('a')] });
    const source = graphqlSource({ isEnabled: enabled });
    const notifications = read(source);

    expect(mocks.createDocumentQuery).toHaveBeenCalledExactlyOnceWith(
      'doc',
      enabled
    );
    expect(notifications()).toEqual([]);
    setEnabled(true);
    expect(notifications().map(({ id }) => id)).toEqual(['a']);
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
