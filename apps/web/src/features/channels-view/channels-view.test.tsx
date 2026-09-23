import type { ChannelEntity } from '@entity/types/entity';
import type { Notification } from '@entity/types/notification';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { batch, createSignal, type JSX, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FullChannel = ChannelEntity & { notifications: Notification[] };
const mocks = vi.hoisted(() => ({
  pass: (props: { children?: JSX.Element }) => props.children,
  selectedId: (): string | undefined => undefined,
  rows: (): ChannelEntity[] => [],
  selectedQuery: vi.fn(),
  markRead: vi.fn(),
  refresh: vi.fn(async () => {}),
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
vi.mock('@app/components/view-shell', () => ({
  ViewShell: {
    Root: mocks.pass,
    Aside: mocks.pass,
    Main: mocks.pass,
    TopBar: mocks.pass,
  },
}));
vi.mock('@app/features/next-soup/utils', () => ({
  markChannelNotificationsSeenOnOpen: mocks.markRead,
}));
vi.mock('@app/features/soup', () => ({
  MaybeSoupEntityActionDrawerManager: mocks.pass,
}));
vi.mock('@app/features/soup/entity-notifications', () => ({
  withEntityNotifications: (entity: FullChannel) => ({
    ...entity,
    notifications: () => entity.notifications,
  }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({}),
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@components/app/PreviewPanel', () => ({
  PreviewPanel: (props: { selectedEntity: ChannelEntity }) => (
    <div data-testid="preview">
      {props.selectedEntity.id}
      <textarea aria-label="Composer" />
    </div>
  ),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { setDisplayName: vi.fn() } }),
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: { Root: mocks.pass, Body: mocks.pass },
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({ StaticMarkdownContext: mocks.pass })
);
vi.mock('@entity', () => ({ ListEntityMetadataQueryProvider: mocks.pass }));
vi.mock('./components/ChannelsMobileView', () => ({
  ChannelsMobileView: () => null,
}));
vi.mock('./components/rail/ChannelsRail', () => ({ ChannelsRail: () => null }));
vi.mock('./channels-view-context', () => ({
  ChannelsViewProvider: mocks.pass,
  useChannelsView: () => ({
    state: {
      asideWidth: 256,
      tab: 'browse',
      mobileTab: 'channels',
      sortBy: { channels: 'updated_at', direct_messages: 'updated_at' },
    },
    mobileLayout: () => false,
    selectedChannel: () =>
      mocks.selectedId()
        ? { type: 'channel', id: mocks.selectedId() }
        : undefined,
    setAsideWidth: vi.fn(),
    setMobileTab: vi.fn(),
  }),
}));
vi.mock('./queries', () => ({
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
  useChannelByIdQuery: mocks.selectedQuery,
  useChannelsSources: () => ({
    channels: { items: () => mocks.rows() },
    direct_messages: { items: () => [] },
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
  [mocks.selectedId, setSelectedId] = createSignal<string | undefined>('one');
  [mocks.rows, setRows] = createSignal([row('one', 'new'), row('two')]);
  const [query, update] = createStore<QueryState>({
    isLoading: false,
    isFetching: false,
    error: null,
    data: { entities: [] },
  });
  setQuery = update;
  mocks.selectedQuery.mockImplementation((_id, enabled: () => boolean) => ({
    get isEnabled() {
      return enabled();
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

describe('channel selection loading and recovery', () => {
  it('offers recovery for a successful empty selection and retries normally', async () => {
    render(() => <ChannelsView />);
    expect(screen.getByText('Conversation unavailable')).toBeTruthy();
    expect(screen.queryByText('Loading conversation')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.markRead).not.toHaveBeenCalled();

    setQuery('isFetching', true);
    expect(screen.getByText('Loading conversation')).toBeTruthy();
    batch(() => {
      setQuery('data', { entities: [full('one', ['new'])] });
      setQuery('isFetching', false);
    });
    expect(screen.getByTestId('preview').textContent).toBe('one');
    expect(mocks.markRead).toHaveBeenCalledOnce();
  });

  it('never marks cached data while a reopened selection is refreshing', async () => {
    setQuery('data', { entities: [full('one', ['old'])] });
    render(() => <ChannelsView />);
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledOnce());
    setSelectedId('two');
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(2));
    mocks.markRead.mockClear();
    batch(() => {
      setSelectedId('one');
      setQuery('isFetching', true);
    });
    expect(screen.getByText('Loading conversation')).toBeTruthy();
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
