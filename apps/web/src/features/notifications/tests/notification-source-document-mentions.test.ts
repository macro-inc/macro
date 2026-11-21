import { type Span, Telemetry } from '@macro-inc/observability';
import { ActiveNotificationIdsTimeoutError } from '@queries/notification/graphql/active-notification-ids';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  fetchActiveNotificationIds: vi.fn(),
  markDone: vi.fn(),
  feedReads: 0,
  patchListener: undefined as undefined | ((patch: unknown) => void),
  reconnectListeners: new Set<() => void>(),
  toastShown: vi.fn(),
}));

type Account = { userId: string; session: number };
// The query account, as `account-scope` reports it: a login bumps the session
// and holds it pending until the new identity arrives.
const [account, setAccount] = createSignal<Account | undefined>();
const [accountPending, setAccountPending] = createSignal(false);

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_DOCUMENT_MENTION_NOTIFICATIONS: false,
}));
vi.mock(
  '@queries/notification/graphql/active-notification-ids',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchActiveNotificationIds: mocks.fetchActiveNotificationIds,
  })
);
vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => account(),
  isCurrentQueryAccount: (captured: Account | undefined) =>
    captured?.userId === account()?.userId &&
    captured?.session === account()?.session,
  queryAccountSessionPending: () => accountPending(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: new Proxy({}, { get: () => mocks.toastShown }),
}));
vi.mock('@queries/notification/user-notifications', () => ({
  // The feed is never started here; reading `data` would be what starts it.
  useUserNotificationsQuery: () => ({
    isStarted: false,
    get data() {
      mocks.feedReads += 1;
      return undefined;
    },
    error: null,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
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
  revalidateNotifiedGraphqlSoupLists: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  mapGraphqlNotification: (notification: UnifiedNotification) => notification,
  subscribeGraphqlSoupReconnected: (listener: () => void) => {
    mocks.reconnectListeners.add(listener);
    return () => mocks.reconnectListeners.delete(listener);
  },
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
let spanAttributes: Map<string, unknown>[] = [];

function mountSource() {
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    createNotificationSource(undefined, signedIn);
  });
}

function reconnect() {
  for (const listener of mocks.reconnectListeners) listener();
}

/** A login that replaces the session in place, without a sign-out. */
async function logIn(userId: string) {
  setAccountPending(true);
  setAccount({ userId, session: (account()?.session ?? 0) + 1 });
  await settle();
  setAccountPending(false);
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  mocks.fetchActiveNotificationIds.mockReset();
  mocks.markDone.mockReset().mockResolvedValue([]);
  mocks.toastShown.mockReset();
  mocks.feedReads = 0;
  spanAttributes = [];
  vi.spyOn(Telemetry, 'span').mockImplementation(((
    _name: string,
    operation: (span: Span) => Promise<unknown>
  ) => {
    const attributes = new Map<string, unknown>();
    spanAttributes.push(attributes);
    return operation({
      setAttr: (key: string, value: unknown) => attributes.set(key, value),
      error: (error: unknown) => attributes.set('status', `error: ${error}`),
    } as unknown as Span);
  }) as typeof Telemetry.span);
  setSignedIn(true);
  setAccount({ userId: 'macro|first@example.com', session: 1 });
  setAccountPending(false);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
});

it('discards active document mentions read by id, never through the feed', async () => {
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
  expect(spanAttributes).toEqual([new Map([['notification.id_count', 2]])]);

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

it('waits for a signed-in session, then reads once per session', async () => {
  mocks.fetchActiveNotificationIds.mockResolvedValue([]);
  setSignedIn(false);
  mountSource();
  await settle();
  expect(mocks.fetchActiveNotificationIds).not.toHaveBeenCalled();

  setSignedIn(true);
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

it.each([
  ['a timed-out read', 'read_timeout'],
  ['a failed read', 'read_failed'],
  ['a failed mark', 'mark_failed'],
] as const)(
  'skips the session after %s: logs once, shows nothing, reads again only at the next sign-in',
  async (failure, errorType) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    if (failure === 'a failed mark') {
      mocks.fetchActiveNotificationIds.mockResolvedValue(['stuck']);
      mocks.markDone.mockRejectedValue(new Error('offline'));
    } else {
      mocks.fetchActiveNotificationIds.mockRejectedValue(
        failure === 'a timed-out read'
          ? new ActiveNotificationIdsTimeoutError()
          : new Error('offline')
      );
    }
    mountSource();

    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(warn).toHaveBeenCalledWith(
      'Skipped document mention cleanup for this session',
      expect.any(Error)
    );
    expect(spanAttributes.at(-1)?.get('error.type')).toBe(errorType);
    expect(spanAttributes.at(-1)?.get('status')).toBe(`error: ${errorType}`);
    expect(mocks.markDone).toHaveBeenCalledTimes(
      failure === 'a failed mark' ? 1 : 0
    );

    // Nothing else in the same session retries it, a reconnect included.
    mocks.patchListener?.({
      __typename: 'GraphqlNewNotification',
      notification: notification('message', 'channel_message_send'),
    });
    reconnect();
    await settle();
    expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(mocks.toastShown).not.toHaveBeenCalled();

    setSignedIn(false);
    await settle();
    setSignedIn(true);
    await logIn('macro|first@example.com');
    await vi.waitFor(() =>
      expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledTimes(2)
    );
  }
);

it("reruns for an account that replaces the session in place, and drops the old account's late read", async () => {
  const reads: Array<(ids: string[]) => void> = [];
  mocks.fetchActiveNotificationIds.mockImplementation(
    () =>
      new Promise<string[]>((resolve) => {
        reads.push(resolve);
      })
  );
  mountSource();
  await settle();
  expect(reads).toHaveLength(1);

  // A native login swaps the account while the source stays signed in.
  await logIn('macro|second@example.com');
  await settle();
  expect(reads).toHaveLength(2);

  reads[0](['first-account-mention']);
  await settle();
  expect(mocks.markDone).not.toHaveBeenCalled();

  reads[1](['second-account-mention']);
  await vi.waitFor(() =>
    expect(mocks.markDone).toHaveBeenCalledExactlyOnceWith({
      notificationIds: ['second-account-mention'],
    })
  );
});

it('reads once more after each websocket reconnect while signed in', async () => {
  mocks.fetchActiveNotificationIds
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(['missed-while-offline']);
  mountSource();
  await settle();
  expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledOnce();

  reconnect();
  await vi.waitFor(() =>
    expect(mocks.markDone).toHaveBeenCalledExactlyOnceWith({
      notificationIds: ['missed-while-offline'],
    })
  );
  expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledTimes(2);

  setSignedIn(false);
  reconnect();
  await settle();
  expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledTimes(2);
});
