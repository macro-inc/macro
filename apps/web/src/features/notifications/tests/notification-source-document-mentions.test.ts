import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  fetchActiveNotificationIds: vi.fn(),
  markDone: vi.fn(),
  feedReads: 0,
  patchListener: undefined as undefined | ((patch: unknown) => void),
}));

const [transport, setTransport] = createSignal<'rest' | 'graphql'>('graphql');
const [restFeed, setRestFeed] = createSignal<UnifiedNotification[]>([]);

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_DOCUMENT_MENTION_NOTIFICATIONS: false,
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => true,
}));
vi.mock('@queries/notification/graphql/active-notification-ids', () => ({
  fetchActiveNotificationIds: mocks.fetchActiveNotificationIds,
}));
vi.mock('@queries/notification/user-notifications', () => ({
  // The facade's GraphQL feed is never started here; reading `data` would be
  // what starts it.
  useUserNotificationsQuery: () => ({
    get isStarted() {
      return transport() === 'rest';
    },
    get data() {
      mocks.feedReads += 1;
      return transport() === 'rest' ? restFeed() : undefined;
    },
    error: null,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    get transport() {
      return transport();
    },
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useMarkNotificationsAsDoneMutation: () => ({
    isPending: false,
    mutateAsync: mocks.markDone,
  }),
  useMarkNotificationsAsSeenMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  optimisticInsertNotification: vi.fn(),
}));
vi.mock('../queries/muted-entities-query', () => ({
  createMutedEntitiesQuery: () => ({
    data: [],
    isPending: false,
    isLoading: false,
  }),
}));
vi.mock('@queries/notification/unsubscribes', () => ({
  useMuteItemMutation: () => ({ mutateAsync: vi.fn() }),
  useUnmuteItemMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/notification/notification-soup', () => ({
  updateSoupForNotification: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  mapGraphqlNotification: (notification: UnifiedNotification) => notification,
}));
vi.mock('@service-storage/graphql-soup-websocket', () => ({
  subscribeToGraphqlNotificationPatches: (
    listener: (patch: unknown) => void
  ) => {
    mocks.patchListener = listener;
    return () => {
      mocks.patchListener = undefined;
    };
  },
}));
vi.mock('@macro-inc/collaboration/websocket', () => ({
  createSocketEffect: vi.fn(),
}));

function notification(
  id: string,
  notification_event_type: string,
  state: UnifiedNotification['state'] = 'unseen'
): UnifiedNotification {
  return {
    id,
    notification_event_type,
    state,
    entity_id: 'channel',
    entity_type: 'channel',
    created_at: '2026-11-16T00:00:00.000Z',
    updated_at: '2026-11-16T00:00:00.000Z',
    viewed_at: null,
    sent: true,
    notification_metadata: {},
  } as unknown as UnifiedNotification;
}

const [signedIn, setSignedIn] = createSignal(true);
let dispose: (() => void) | undefined;

function mountSource() {
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    createNotificationSource(
      {} as ConnectionGatewayWebsocket,
      undefined,
      signedIn
    );
  });
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  mocks.fetchActiveNotificationIds.mockReset();
  mocks.markDone.mockReset().mockResolvedValue([]);
  mocks.feedReads = 0;
  setTransport('graphql');
  setRestFeed([]);
  setSignedIn(true);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it('discards active document mentions read by id in GraphQL mode, never through the feed', async () => {
  mocks.fetchActiveNotificationIds.mockResolvedValue(['older', 'newer']);
  mountSource();

  await vi.waitFor(() =>
    expect(mocks.markDone).toHaveBeenCalledWith({
      notificationIds: ['older', 'newer'],
    })
  );
  expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledTimes(1);
  expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledWith(
    ['document_mention'],
    500
  );

  mocks.patchListener?.({
    __typename: 'GraphqlNewNotification',
    notification: notification('arrived', 'document_mention'),
  });
  mocks.patchListener?.({
    __typename: 'GraphqlNewNotification',
    notification: notification('message', 'channel_message_send'),
  });
  await settle();

  expect(mocks.markDone).toHaveBeenCalledTimes(2);
  expect(mocks.markDone).toHaveBeenLastCalledWith({
    notificationIds: ['arrived'],
  });
  expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledTimes(1);
  expect(mocks.feedReads).toBe(0);
});

it('waits for a signed-in session with settled GraphQL flags, then reads once per session', async () => {
  mocks.fetchActiveNotificationIds.mockResolvedValue([]);
  setSignedIn(false);
  mountSource();
  await settle();
  expect(mocks.fetchActiveNotificationIds).not.toHaveBeenCalled();

  // Flags still loading report the REST transport.
  setTransport('rest');
  setSignedIn(true);
  await settle();
  expect(mocks.fetchActiveNotificationIds).not.toHaveBeenCalled();

  setTransport('graphql');
  await settle();
  expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledTimes(1);

  setSignedIn(false);
  await settle();
  setSignedIn(true);
  await settle();
  expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledTimes(2);
  expect(mocks.markDone).not.toHaveBeenCalled();
});

it('drops a read that lands after the session ended', async () => {
  let respond: (ids: string[]) => void = () => {};
  mocks.fetchActiveNotificationIds.mockReturnValue(
    new Promise<string[]>((resolve) => {
      respond = resolve;
    })
  );
  mountSource();
  await settle();

  setSignedIn(false);
  respond(['stale']);
  await settle();

  expect(mocks.markDone).not.toHaveBeenCalled();
});

it('keeps discarding feed document mentions in REST mode without the id read', async () => {
  setTransport('rest');
  setRestFeed([
    notification('active', 'document_mention'),
    notification('discarded', 'document_mention', 'done'),
    notification('message', 'channel_message_send'),
  ]);
  mountSource();

  await vi.waitFor(() =>
    expect(mocks.markDone).toHaveBeenCalledWith({
      notificationIds: ['active'],
    })
  );
  expect(mocks.fetchActiveNotificationIds).not.toHaveBeenCalled();
});
