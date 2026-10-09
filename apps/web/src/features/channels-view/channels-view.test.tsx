import { ThrownResultError } from '@core/util/result';
import type { ChannelEntity } from '@entity/types/entity';
import type { Notification } from '@entity/types/notification';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { CombinedError } from '@urql/core';
import { batch, createSignal, For, type JSX, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelsDataSource } from './queries';
import type { ChannelsQueryScope } from './types';

type FullChannel = ChannelEntity & { notifications: Notification[] };
const mocks = vi.hoisted(() => ({
  pass: (props: { children?: JSX.Element }) => props.children,
  selectedId: (): string | undefined => undefined,
  rows: (): ChannelEntity[] => [],
  mobileLayout: (): boolean => false,
  active: (): boolean => true,
  searchOpen: (): boolean => false,
  searchText: (): string => '',
  mobileTab: (): ChannelsQueryScope => 'channels',
  selectedQuery: vi.fn(),
  markRead: vi.fn(),
  resolveTarget: vi.fn(() => ({ kind: 'message', messageId: 'unread' })),
  refresh: vi.fn(async () => {}),
}));

vi.mock('@app/features/command/mobile/mobileSearchState', () => ({
  SearchState: {
    isOpen: () => mocks.searchOpen(),
    query: () => mocks.searchText(),
  },
}));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => ({ isSuccess: false, isLoading: false }),
  validateSearchServiceText: (text: string) => text.length >= 3,
}));
vi.mock('@app/lib/split-router', () => ({
  SplitRouter: {
    Outlet: (props: { fallback: () => JSX.Element }) => (
      <Show when={mocks.selectedId()} fallback={props.fallback()}>
        <ChannelDetailRouteView />
      </Show>
    ),
  },
}));
vi.mock('@app/features/tours/ViewTour', () => ({ ViewTour: () => null }));
vi.mock('@app/components/view-shell', () => ({
  ViewShell: {
    Root: mocks.pass,
    Aside: mocks.pass,
    Main: mocks.pass,
    TopBar: mocks.pass,
  },
}));
vi.mock('@app/features/next-soup/utils', () => ({
  getChannelEntityTarget: mocks.resolveTarget,
  markChannelNotificationsSeenOnOpen: mocks.markRead,
}));
vi.mock('@app/features/soup', () => ({
  MaybeSoupEntityActionDrawerManager: mocks.pass,
}));
vi.mock('@app/features/soup/entity-notifications', () => ({
  withEntityNotifications: (entity: FullChannel) => ({
    ...entity,
    notifications:
      typeof entity.notifications === 'function'
        ? entity.notifications
        : () => entity.notifications,
  }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({}),
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@components/app/PreviewPanel', () => ({
  PreviewPanel: (props: { target: { blockId: string } }) => (
    <div data-testid="legacy-preview">
      {props.target.blockId}
      <textarea aria-label="Composer" />
    </div>
  ),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { setDisplayName: vi.fn(), isActive: () => mocks.active() },
  }),
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: { Root: mocks.pass, Body: mocks.pass },
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({ StaticMarkdownContext: mocks.pass })
);
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ListEntityMetadataQueryProvider: mocks.pass,
}));
vi.mock('./components/ChannelDetailView', () => ({
  ChannelDetailView: (props: { channel: ChannelEntity; target?: unknown }) => (
    <div
      data-testid="channel-detail"
      data-target={JSON.stringify(props.target)}
    >
      {props.channel.id}
      <textarea aria-label="Composer" />
    </div>
  ),
}));
vi.mock('./components/ChannelThreadsView', () => ({
  ChannelThreadsView: () => <div data-testid="channel-threads" />,
}));
vi.mock('./components/ChannelsMobileView', () => ({
  ChannelsMobileView: (props: {
    source: ChannelsDataSource;
    searchQuery: string;
  }) => (
    <div data-testid="mobile-channels" data-query={props.searchQuery}>
      <For each={props.source.items()}>
        {(channel) => <div>{channel.name}</div>}
      </For>
    </div>
  ),
}));
vi.mock('./components/rail/ChannelsRail', () => ({ ChannelsRail: () => null }));
vi.mock('@channel/Channel/channel-entity', () => ({
  useChannelByIdQuery: mocks.selectedQuery,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.mobileLayout(),
}));
vi.mock('@app/features/soup/search/context', () => ({
  useOptionalSearchContext: () => undefined,
}));
vi.mock('./channels-view-context', () => ({
  ChannelsViewProvider: mocks.pass,
  useChannelsView: () => ({
    state: {
      asideWidth: 256,
      tab: 'browse',
      get mobileTab() {
        return mocks.mobileTab();
      },
      sortBy: { channels: 'updated_at', direct_messages: 'updated_at' },
    },
    tab: () => 'browse',
    mobileLayout: () => mocks.mobileLayout(),
    selectedChannel: () =>
      mocks.selectedId()
        ? { type: 'channel', id: mocks.selectedId() }
        : undefined,
    setAsideWidth: vi.fn(),
    setMobileTab: vi.fn(),
  }),
}));
vi.mock('./queries', () => ({
  filterChannelsForScope: (_scope: string, channels: ChannelEntity[]) =>
    channels,
  deduplicateChannels: (collections: ChannelEntity[][]) => [
    ...new Map(
      collections.flat().map((channel) => [channel.id, channel])
    ).values(),
  ],
  resolveSelectedChannel: (
    id: string | undefined,
    loaded: ChannelEntity[],
    fallback: ChannelEntity[] = []
  ) => [...loaded, ...fallback].find((channel) => channel.id === id),
  useChannelsSources: () => ({
    channels: { items: () => mocks.rows() },
    direct_messages: { items: () => mocks.rows() },
    recents: { items: () => [] },
    search: { items: () => [] },
  }),
}));

import { ChannelDetailRouteView, ChannelsView } from './channels-view';

const row = (id: string, unreadId?: string): ChannelEntity => ({
  id,
  type: 'channel',
  name: id,
  ownerId: 'viewer',
  channelType: 'private',
  isParticipant: true,
  unreadNotifications: unreadId
    ? [{ id: unreadId, state: 'unseen', createdAt: '2026-01-01' }]
    : [],
});
const full = (id: string, notificationIds: string[]): FullChannel => ({
  ...row(id),
  unreadNotifications: undefined,
  notifications: notificationIds.map((notificationId) => ({
    id: notificationId,
    entity_id: id,
    entity_type: 'channel',
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: { messageId: notificationId, channelType: 'private' },
    },
    sent: true,
    state: 'unseen',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  })),
});

type QueryState = {
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  data: { entities: FullChannel[] } | undefined;
};
let setQuery: ReturnType<typeof createStore<QueryState>>[1];
let setSelectedId: ReturnType<typeof createSignal<string | undefined>>[1];
let setRows: ReturnType<typeof createSignal<ChannelEntity[]>>[1];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mobileLayout = () => false;
  mocks.active = () => true;
  mocks.searchOpen = () => false;
  mocks.searchText = () => '';
  mocks.mobileTab = () => 'channels';
  [mocks.selectedId, setSelectedId] = createSignal<string | undefined>('one');
  [mocks.rows, setRows] = createSignal([row('one', 'new'), row('two')]);
  const [query, update] = createStore<QueryState>({
    isLoading: false,
    isFetching: false,
    error: null,
    data: { entities: [full('two', [])] },
  });
  setQuery = update;
  mocks.selectedQuery.mockImplementation((_id, enabled: () => boolean) => ({
    get isEnabled() {
      return enabled();
    },
    get isPending() {
      return query.isLoading;
    },
    get isLoading() {
      return query.isLoading;
    },
    get isFetching() {
      return query.isFetching;
    },
    get error() {
      return query.error;
    },
    get data() {
      return query.data;
    },
    refresh: mocks.refresh,
  }));
});
afterEach(cleanup);

describe('mobile dock search wiring', () => {
  it('filters DMs from the active dock session and restores rows on close or navigation', async () => {
    mocks.mobileLayout = () => true;
    mocks.mobileTab = () => 'direct_messages';
    const [open, setOpen] = createSignal(true);
    const [text, setText] = createSignal('');
    const [active, setActive] = createSignal(true);
    mocks.searchOpen = open;
    mocks.searchText = text;
    mocks.active = active;
    setRows([
      {
        ...row('julia'),
        name: 'Julia Westphal',
        channelType: 'direct_message',
      },
      { ...row('hutch'), name: 'hutch', channelType: 'direct_message' },
    ]);
    render(() => <ChannelsView />);
    expect(screen.getByText('hutch')).toBeTruthy();
    setText('Julia');
    await waitFor(() =>
      expect(screen.getByText('Julia Westphal')).toBeTruthy()
    );
    await waitFor(() => expect(screen.queryByText('hutch')).toBeNull());
    setActive(false);
    expect(screen.getByText('hutch')).toBeTruthy();
    setActive(true);
    await waitFor(() => expect(screen.queryByText('hutch')).toBeNull());
    setOpen(false);
    expect(screen.getByText('hutch')).toBeTruthy();
    expect(screen.getByTestId('mobile-channels').dataset.query).toBe('');
  });
});

describe('channel selection loading and recovery', () => {
  it.each(['pointerDown', 'keyDown', 'wheel'] as const)(
    'stays at latest after %s and notification hydration',
    (event) => {
      setQuery({ isFetching: true, data: undefined });
      render(() => <ChannelsView />);
      const composer = screen.getByRole('textbox', { name: 'Composer' });
      fireEvent[event](composer);
      batch(() =>
        setQuery({
          isFetching: false,
          data: { entities: [full('one', ['unread'])] },
        })
      );
      expect(mocks.resolveTarget).not.toHaveBeenCalled();
      expect(screen.getByTestId('channel-detail').dataset.target).toBe(
        JSON.stringify({ kind: 'latest' })
      );
      expect(mocks.markRead).toHaveBeenCalledOnce();
    }
  );

  it('stays at latest after mounting when notifications arrive', () => {
    setQuery({ isFetching: true, data: undefined });
    render(() => <ChannelsView />);
    const composer = screen.getByRole('textbox', { name: 'Composer' });
    batch(() =>
      setQuery({
        isFetching: false,
        data: { entities: [full('one', ['unread'])] },
      })
    );
    expect(screen.getByTestId('channel-detail').dataset.target).toBe(
      JSON.stringify({ kind: 'latest' })
    );
    expect(screen.getByRole('textbox', { name: 'Composer' })).toBe(composer);
  });

  it('preserves an already-loaded full notification edge on route open', () => {
    setRows([full('one', ['unread-message'])]);
    render(() => <ChannelsView />);
    expect(mocks.markRead).toHaveBeenCalledOnce();
    const marked = mocks.markRead.mock.calls[0][0];
    expect(
      marked
        .notifications()
        .map((notification: Notification) => notification.id)
    ).toEqual(['unread-message']);
  });

  it('keeps the composer mounted and focused across loading, failure, retry, and recovery', () => {
    setQuery({ isFetching: true, data: undefined });
    render(() => <ChannelsView />);
    const composer = screen.getByRole('textbox', { name: 'Composer' });
    composer.focus();
    batch(() => setQuery({ isFetching: false, error: new Error('Offline') }));
    expect(screen.getByRole('textbox', { name: 'Composer' })).toBe(composer);
    batch(() => setQuery({ isFetching: true, error: null }));
    expect(screen.getByRole('textbox', { name: 'Composer' })).toBe(composer);
    batch(() =>
      setQuery({
        isFetching: false,
        data: { entities: [full('one', ['new'])] },
      })
    );
    expect(screen.getByRole('textbox', { name: 'Composer' })).toBe(composer);
    expect(document.activeElement).toBe(composer);
    expect(mocks.markRead).toHaveBeenCalledOnce();
  });

  it.each([
    new Error('Connection interrupted'),
    new ThrownResultError([{ code: 'NETWORK_ERROR', message: 'Offline' }]),
    new ThrownResultError([{ code: 'SERVER_ERROR', message: 'Server failed' }]),
    new CombinedError({ networkError: new Error('Offline') }),
    new CombinedError({
      networkError: new Error('HTTP 503'),
      response: { status: 503 },
    }),
  ])(
    'renders an empty unread projection after a transient failure without marking read: %s',
    (error) => {
      setSelectedId('two');
      setQuery({ error, data: undefined });
      render(() => <ChannelsView />);
      expect(screen.getByTestId('channel-detail').textContent).toBe('two');
      expect(screen.queryByText('Conversation unavailable')).toBeNull();
      expect(mocks.markRead).not.toHaveBeenCalled();

      batch(() => {
        setQuery('data', { entities: [full('two', ['fresh'])] });
        setQuery('error', null);
      });
      expect(mocks.markRead).toHaveBeenCalledOnce();
      const marked = mocks.markRead.mock.calls[0][0] as {
        notifications: () => Notification[];
      };
      expect(
        marked.notifications().map((notification) => notification.id)
      ).toEqual(['fresh']);
    }
  );

  it('does not mark a cached nonempty unread projection on a transient failure', () => {
    setQuery({ error: new Error('Offline'), data: undefined });
    render(() => <ChannelsView />);
    expect(screen.getByTestId('channel-detail').textContent).toBe('one');
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it.each([
    new ThrownResultError([{ code: 'UNAUTHORIZED', message: 'Unauthorized' }]),
    new ThrownResultError([{ code: 'FORBIDDEN', message: 'Forbidden' }]),
    new ThrownResultError([{ code: 'NOT_FOUND', message: 'Not found' }]),
    new CombinedError({
      networkError: new Error('HTTP 401'),
      response: { status: 401 },
    }),
    new CombinedError({
      networkError: new Error('HTTP 403'),
      response: { status: 403 },
    }),
    new CombinedError({
      graphQLErrors: [
        { message: 'Forbidden', extensions: { code: 'FORBIDDEN' } },
      ],
    }),
  ])(
    'keeps access failures unavailable even with cached or previously loaded data: %s',
    (error) => {
      setSelectedId('two');
      setQuery('error', error);
      render(() => <ChannelsView />);
      expect(screen.getByText('Conversation unavailable')).toBeTruthy();
      expect(screen.queryByTestId('channel-detail')).toBeNull();
      expect(mocks.markRead).not.toHaveBeenCalled();

      setQuery('error', null);
      expect(screen.getByTestId('channel-detail').textContent).toBe('two');
      mocks.markRead.mockClear();
      setQuery('error', error);
      expect(screen.getByText('Conversation unavailable')).toBeTruthy();
      expect(screen.queryByTestId('channel-detail')).toBeNull();
      expect(mocks.markRead).not.toHaveBeenCalled();
    }
  );

  it('keeps an uncached channel unavailable after a transient failure', () => {
    setRows([]);
    setQuery({ error: new Error('Offline'), data: undefined });
    render(() => <ChannelsView />);
    expect(screen.getByText('Conversation unavailable')).toBeTruthy();
    expect(screen.queryByTestId('channel-detail')).toBeNull();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('shows the selected channel while its notification data is still loading', () => {
    setSelectedId('two');
    render(() => <ChannelsView />);
    expect(screen.getByTestId('channel-detail').textContent).toBe('two');
    mocks.markRead.mockClear();

    batch(() => {
      setQuery('isFetching', true);
      setSelectedId('one');
    });
    expect(screen.getByTestId('channel-detail').textContent).toBe('one');
    expect(screen.queryByText('Loading conversation')).toBeNull();
    expect(mocks.markRead).not.toHaveBeenCalled();

    batch(() => {
      setQuery('data', { entities: [full('one', ['new'])] });
      setQuery('isFetching', false);
    });
    expect(screen.getByTestId('channel-detail').textContent).toBe('one');
    expect(mocks.markRead).toHaveBeenCalledOnce();
  });

  it('renders an empty unread projection while refreshing its notifications', () => {
    setSelectedId('two');
    setQuery('isFetching', true);
    render(() => <ChannelsView />);
    expect(screen.getByTestId('channel-detail')).toBeTruthy();
    expect(mocks.markRead).not.toHaveBeenCalled();
    batch(() => {
      setQuery('data', { entities: [full('two', ['arrived-after-list'])] });
      setQuery('isFetching', false);
    });
    expect(screen.getByTestId('channel-detail').textContent).toBe('two');
    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'two' }),
      expect.anything(),
      { channelReadScope: 'top-level' }
    );
  });

  it('offers recovery for a successful empty selection and retries normally', async () => {
    render(() => <ChannelsView />);
    expect(screen.getByText('Conversation unavailable')).toBeTruthy();
    expect(screen.queryByText('Loading conversation')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.markRead).not.toHaveBeenCalled();

    setQuery('isFetching', true);
    expect(screen.getByTestId('channel-detail').textContent).toBe('one');
    batch(() => {
      setQuery('data', { entities: [full('one', ['new'])] });
      setQuery('isFetching', false);
    });
    expect(screen.getByTestId('channel-detail').textContent).toBe('one');
    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'one' }),
      expect.anything(),
      { channelReadScope: 'top-level' }
    );
  });

  it('never marks cached data while a reopened selection is refreshing', async () => {
    setQuery('data', { entities: [full('one', ['old']), full('two', [])] });
    render(() => <ChannelsView />);
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledOnce());
    setSelectedId('two');
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(2));
    mocks.markRead.mockClear();
    batch(() => {
      setSelectedId('one');
      setQuery('isFetching', true);
    });
    expect(screen.getByTestId('channel-detail')).toBeTruthy();
    expect(mocks.markRead).not.toHaveBeenCalled();
    batch(() => {
      setQuery('data', { entities: [full('one', ['old', 'new'])] });
      setQuery('isFetching', false);
    });
    expect(mocks.markRead).toHaveBeenCalledOnce();
    const marked = mocks.markRead.mock.calls[0][0] as {
      notifications: () => Notification[];
    };
    expect(
      marked.notifications().map((notification) => notification.id)
    ).toEqual(['old', 'new']);
  });

  it('keeps an already-open read conversation focused when its unread edge changes', async () => {
    setSelectedId('two');
    render(() => <ChannelsView />);
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledOnce());
    const composer = screen.getByRole('textbox', { name: 'Composer' });
    composer.focus();
    mocks.markRead.mockClear();
    setRows([row('one', 'new'), row('two', 'incoming')]);
    expect(screen.getByRole('textbox', { name: 'Composer' })).toBe(composer);
    expect(document.activeElement).toBe(composer);
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('keeps no selection distinct from an unavailable conversation', () => {
    setQuery('error', new Error('previous selection failed'));
    setSelectedId(undefined);
    render(() => <ChannelsView />);
    expect(screen.getByText('Select a conversation')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
