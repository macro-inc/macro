import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createNotificationSource,
  type NotificationSource,
} from '../notification-source';

const mocks = vi.hoisted(() => ({
  queryClient: undefined as unknown,
  userNotifications: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_DOCUMENT_MENTION_NOTIFICATIONS: true,
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => false,
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return mocks.queryClient;
  },
}));
vi.mock('@service-notification/client', () => ({
  notificationServiceClient: { userNotifications: mocks.userNotifications },
  channelMentionMetadata: {},
  documentMentionMetadata: {},
}));
vi.mock('@queries/notification/graphql/user-notifications', () => ({
  createGraphqlNotificationsQuery: vi.fn(),
  createGraphqlUpdateNotificationsMutation: () => ({
    isPending: false,
    error: null,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  }),
}));
vi.mock('@queries/notification/unsubscribes', () => ({
  createMutedEntitiesQuery: () => ({ data: [], isLoading: false }),
  useMuteItemMutation: () => ({ mutateAsync: vi.fn() }),
  useUnmuteItemMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/notification/notification-soup', () => ({
  updateSoupForNotification: vi.fn(),
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: vi.fn(),
}));
vi.mock('@service-storage/graphql-notifications', () => ({
  updateNotifications: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  graphqlCacheEnabled: () => false,
  mapGraphqlNotification: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup-websocket', () => ({
  subscribeToGraphqlNotificationPatches: () => () => {},
}));
vi.mock('@macro-inc/collaboration/websocket', () => ({
  createSocketEffect: vi.fn(),
}));

// Resolve as a macrotask like a network response; a microtask chain would let a
// pagination loop starve the timers this test waits on.
function respond<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

function page(ids: string[], nextCursor: string | null) {
  return ok({
    items: ids.map((id) => ({
      id,
      owner_id: 'user',
      entity_id: 'doc',
      entity_type: 'document',
      created_at: '2026-10-18T00:00:00.000Z',
      updated_at: '2026-10-18T00:00:00.000Z',
      viewed_at: null,
      state: 'unseen',
      sent: true,
      notification_event_type: 'test',
      notification_metadata: {},
    })),
    next_cursor: nextCursor,
  });
}

const unauthorized = () =>
  err([{ code: 'UNAUTHORIZED', message: 'Unauthorized' }]);

async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

let queryClient: QueryClient;
let unmount: (() => void) | undefined;

function mountSource(): NotificationSource {
  let source: NotificationSource | undefined;
  function Probe() {
    source = createNotificationSource({} as ConnectionGatewayWebsocket);
    return null;
  }
  unmount = render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  )).unmount;
  if (!source) throw new Error('notification source did not mount');
  return source;
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.queryClient = queryClient;
  mocks.userNotifications.mockReset();
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  queryClient.clear();
});

it('requests a failed page once and resumes after the next successful fetch', async () => {
  mocks.userNotifications
    .mockImplementationOnce(() => respond(page(['first'], 'cursor-1')))
    .mockImplementation(() => respond(unauthorized()));
  const source = mountSource();

  await vi.waitFor(() =>
    expect(source._notificationsQuery.error).not.toBeNull()
  );
  await settle();
  expect(mocks.userNotifications).toHaveBeenCalledTimes(2);
  expect(mocks.userNotifications).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'cursor-1' })
  );
  expect(source.notifications().map((n) => n.id)).toEqual(['first']);

  mocks.userNotifications
    .mockImplementationOnce(() => respond(page(['first'], 'cursor-1')))
    .mockImplementationOnce(() => respond(page(['second'], null)));
  await source._notificationsQuery.refetch();
  await vi.waitFor(() =>
    expect(source.notifications().map((n) => n.id)).toEqual(['first', 'second'])
  );
  expect(mocks.userNotifications).toHaveBeenCalledTimes(4);
});
