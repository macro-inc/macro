import type { EmailEntity } from '@entity/types/entity';
import type { GetNotificationTypePreferencesResponse } from '@service-notification/generated/schemas/getNotificationTypePreferencesResponse';
import type { NotificationState } from '@service-storage/graphql/generated/graphql';
import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  type UseQueryResult,
  useQuery,
} from '@tanstack/solid-query';
import { createEffect, createRoot, createSignal, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePresenceUnread } from './use-presence-unread';

const mocks = vi.hoisted(() => ({
  home: vi.fn(),
  email: vi.fn(),
  channels: vi.fn(),
  withLocalState: vi.fn(),
  hasUnreadEntity: vi.fn(),
  transformEntities: vi.fn(),
  notificationPreferences: vi.fn(),
}));

vi.mock('@queries/channel/unread-presence', () => ({
  createChannelUnreadQuery: mocks.channels,
}));

vi.mock('@app/features/email-view/queries/email-query', () => ({
  buildEmailQuery: () => ({ params: {}, body: {} }),
}));
vi.mock('@app/features/home/queries/use-home-unread-query', () => ({
  useHomeUnreadQuery: mocks.home,
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: mocks.email,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({
    withLocalState: mocks.withLocalState,
  }),
}));
vi.mock('@queries/notification/type-preferences', () => ({
  useNotificationTypePreferencesQuery: mocks.notificationPreferences,
}));
// Query builders import the soup barrel, which otherwise opens real sockets.
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

const unreadEmail: EmailEntity = {
  id: 'email',
  type: 'email',
  name: 'Important email',
  ownerId: 'user',
  isRead: false,
  isDraft: false,
  isImportant: true,
  done: false,
};

let dispose: VoidFunction;
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  dispose?.();
  for (const client of clients.splice(0)) client.clear();
  onlineManager.setOnline(true);
  vi.clearAllMocks();
});

function setup(
  preferences?: () => UseQueryResult<GetNotificationTypePreferencesResponse>
) {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [done, setDone] = createSignal(false);
    const [disabledTypes, setDisabledTypes] = createSignal<string[]>([]);
    mocks.withLocalState.mockImplementation(({ state }) =>
      done() ? 'done' : state
    );
    mocks.notificationPreferences.mockImplementation(
      preferences ??
        (() => ({
          isPending: false,
          get data() {
            return { disabled_types: disabledTypes() };
          },
        }))
    );
    const [witnesses, setWitnesses] = createSignal<
      { id: string; state: NotificationState }[]
    >([]);
    const [loading, setLoading] = createSignal(true);
    const [fetching, setFetching] = createSignal(true);
    mocks.channels.mockReturnValue({
      isEnabled: true,
      get isPending() {
        return loading();
      },
      get isLoading() {
        return loading() && fetching();
      },
      get data() {
        if (loading()) throw new Error('Read pending unread query');
        return witnesses();
      },
    });
    const [emails, setEmails] = createSignal<EmailEntity[]>([]);
    const query = {
      get isPending() {
        return loading();
      },
      get isLoading() {
        return loading() && fetching();
      },
      get data() {
        if (loading()) throw new Error('Read pending resource');
        return { entities: emails() };
      },
    };
    mocks.hasUnreadEntity.mockImplementation((items: EmailEntity[]) =>
      items.some((item) => !item.done && !item.isRead)
    );
    mocks.home.mockReturnValue(() =>
      loading() ? false : mocks.hasUnreadEntity(emails())
    );
    mocks.email.mockReturnValue(query);
    return {
      unread: usePresenceUnread(),
      setLoading,
      setFetching,
      setEmails,
      setWitnesses,
      setDone,
      setDisabledTypes,
    };
  });
}

describe('navigation unread presence', () => {
  it('does not read pending email or channel data when their requests pause', () => {
    const { unread, setFetching } = setup();
    setFetching(false);
    expect(unread('mail')).toBe(false);
    expect(unread('channels')).toBe(false);
  });

  it.each([true, false])(
    'keeps the shell mounted with pending preferences (online=%s), then applies them',
    async (online) => {
      onlineManager.setOnline(online);
      const response =
        Promise.withResolvers<GetNotificationTypePreferencesResponse>();
      const applied = Promise.withResolvers<void>();
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      clients.push(client);
      function Shell() {
        const { unread, setLoading, setEmails } = setup(() =>
          useQuery(() => ({
            queryKey: ['preferences'],
            queryFn: () => response.promise,
          }))
        );
        setLoading(false);
        setEmails([unreadEmail]);
        createEffect(() => {
          if (!unread('mail')) applied.resolve();
        });
        return <nav data-testid="shell" data-unread={unread('mail')} />;
      }
      render(() => (
        <QueryClientProvider client={client}>
          <Suspense fallback={<div data-testid="suspended" />}>
            <Shell />
          </Suspense>
        </QueryClientProvider>
      ));
      const shell = screen.getByTestId('shell');
      expect(shell.dataset.unread).toBe('true');
      expect(screen.queryByTestId('suspended')).toBeNull();
      expect(client.getQueryState(['preferences'])?.fetchStatus).toBe(
        online ? 'fetching' : 'paused'
      );
      onlineManager.setOnline(true);
      response.resolve({ disabled_types: ['new_email'] });
      await applied.promise;
      expect(shell.dataset.unread).toBe('false');
      expect(screen.getByTestId('shell')).toBe(shell);
      expect(screen.queryByTestId('suspended')).toBeNull();
    }
  );

  it('retains cached disabled preferences after a failed background refresh', async () => {
    const response =
      Promise.withResolvers<GetNotificationTypePreferencesResponse>();
    const failed = Promise.withResolvers<void>();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    function Shell() {
      const { unread, setLoading, setEmails } = setup(() => {
        const query = useQuery(() => ({
          queryKey: ['preferences'],
          queryFn: () => response.promise,
          initialData: { disabled_types: ['new_email'] },
        }));
        createEffect(() => {
          if (query.isError) failed.resolve();
        });
        return query;
      });
      setLoading(false);
      setEmails([unreadEmail]);
      return <nav data-testid="shell" data-unread={unread('mail')} />;
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Suspense fallback={<div data-testid="suspended" />}>
          <Shell />
        </Suspense>
      </QueryClientProvider>
    ));
    const shell = screen.getByTestId('shell');
    expect(shell.dataset.unread).toBe('false');
    response.reject(new Error('Service unreachable'));
    await failed.promise;
    expect(client.getQueryState(['preferences'])?.status).toBe('error');
    expect(screen.getByTestId('shell')).toBe(shell);
    expect(shell.dataset.unread).toBe('false');
    expect(screen.queryByTestId('suspended')).toBeNull();
  });

  it('does not read pending resources or badge unrelated navigation', () => {
    const { unread } = setup();
    for (const id of ['home', 'mail', 'channels', 'documents', 'agents']) {
      expect(unread(id)).toBe(false);
    }
    expect(mocks.hasUnreadEntity).not.toHaveBeenCalled();
    expect(mocks.transformEntities).not.toHaveBeenCalled();
  });

  it('reacts to read, unread, and done changes in loaded rows', () => {
    const { unread, setLoading, setEmails } = setup();
    setLoading(false);
    setEmails([unreadEmail]);
    expect(unread('home')).toBe(true);
    expect(unread('mail')).toBe(true);
    expect(mocks.hasUnreadEntity).toHaveBeenLastCalledWith([unreadEmail]);
    expect(mocks.transformEntities).not.toHaveBeenCalled();
    setEmails([{ ...unreadEmail, isRead: true }]);
    expect(unread('home')).toBe(false);
    expect(unread('mail')).toBe(false);
    setEmails([unreadEmail]);
    expect(unread('mail')).toBe(true);
    setEmails([{ ...unreadEmail, done: true }]);
    expect(unread('home')).toBe(false);
    expect(unread('mail')).toBe(false);
  });

  it('uses bounded GraphQL witnesses without reading the full feed', () => {
    const { unread, setLoading, setWitnesses, setDone } = setup();
    expect(unread('channels')).toBe(false);
    expect(mocks.channels.mock.calls[0][0]).toMatchObject({
      initial: {
        limit: 500,
        filters: {
          channelFilter: { literal: { notificationState: 'UNSEEN' } },
        },
      },
    });
    setLoading(false);
    setWitnesses([{ id: 'witness', state: 'UNSEEN' }]);
    expect(unread('channels')).toBe(true);
    setDone(true);
    expect(unread('channels')).toBe(false);
    setDone(false);
    expect(unread('channels')).toBe(true);
    setWitnesses([{ id: 'witness', state: 'SEEN' }]);
    expect(unread('channels')).toBe(false);
    setWitnesses([]);
    expect(unread('channels')).toBe(false);
  });

  it('hides email badge when email notifications are disabled', () => {
    const { unread, setLoading, setEmails, setDisabledTypes } = setup();
    setLoading(false);
    setEmails([unreadEmail]);
    expect(unread('mail')).toBe(true);
    setDisabledTypes(['new_email']);
    expect(unread('mail')).toBe(false);
    setDisabledTypes([]);
    expect(unread('mail')).toBe(true);
    setDisabledTypes(['channel_mention', 'new_email', 'task_assigned']);
    expect(unread('mail')).toBe(false);
  });
});
