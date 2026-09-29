import type { ChannelPreviewSelection } from '@app/features/next-soup/utils';
import type { ChannelEntity } from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelsSources } from '../../queries';
import type { ChannelRailRow } from './ChannelsRailContext';

const mocks = vi.hoisted(() => ({
  fetchChannel: vi.fn<(id: string) => Promise<ChannelEntity>>(),
  favoriteId: undefined as string | undefined,
  hydrate:
    vi.fn<
      (
        channel: ChannelEntity
      ) =>
        | WithNotification<ChannelEntity>
        | Promise<WithNotification<ChannelEntity>>
    >(),
  markRead: vi.fn(),
  navigate: vi.fn(async () => {}),
  openSplit: vi.fn(async () => {}),
  select: vi.fn((_channel: ChannelPreviewSelection) => true),
  selected: undefined as ChannelPreviewSelection | undefined,
  source: {},
  activate: (_event: MouseEvent) => {},
  row: undefined as ChannelEntity | undefined,
  failure: vi.fn(),
}));
vi.mock('@app/components/list', () => ({
  createListController: (options: {
    onActivate: (event: {
      item: ChannelRailRow;
      metadata: { event: MouseEvent };
    }) => void;
  }) => {
    mocks.activate = (event) =>
      options.onActivate({
        item: mocks.favoriteId
          ? {
              kind: 'favorite',
              id: `favorite:channel:${mocks.favoriteId}`,
              group: 'favorites',
              favorite: {
                entityType: 'channel',
                entityId: mocks.favoriteId,
                createdAt: '2026-01-01',
                sortOrder: 0,
              },
            }
          : {
              kind: 'conversation',
              id: 'channel:one',
              scope: 'channels',
              localIndex: 0,
              channel: mocks.row!,
            },
        metadata: { event },
      });
    return {};
  },
  listOwnedSlotName: (name: string) => name,
  useListInteractions: vi.fn(),
}));
vi.mock('@app/components/view-shell', () => ({
  useViewControlHotkeys: vi.fn(),
  useViewTabHotkeys: vi.fn(),
}));
vi.mock('@app/features/next-soup/utils', () => ({
  channelPreviewSelection: (
    id: string,
    options?: {
      target?: { kind: string; messageId?: string; threadId?: string };
    }
  ) => ({
    type: 'channel',
    id,
    ...(options?.target?.kind === 'message'
      ? {
          target: {
            messageId: options.target.messageId,
            threadId: options.target.threadId,
          },
        }
      : {}),
  }),
  getChannelEntityTarget: () => ({ kind: 'latest' }),
  markChannelNotificationsSeenOnOpen: mocks.markRead,
  navigateChannelEntityToTarget: mocks.navigate,
  openEntityInSplitFromUnifiedList: mocks.openSplit,
}));
vi.mock('@app/features/soup/entity-notifications', () => ({
  withEntityNotifications: (channel: ChannelEntity) => channel,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@app/util/favorites', () => ({ favoriteSplitContent: vi.fn() }));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => mocks.source,
  useGlobalBlockOrchestrator: () => ({}),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openSplit }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ isPanelActive: () => true }),
  withSplitPanelOwner: (_name: string, run: () => unknown) => run(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@core/constant/featureFlags', () => ({ enableChannelTags: {} }));
vi.mock('@core/hotkey/hotkeys', () => ({
  createHotkeyGroup: () => ({ dispose: vi.fn() }),
  registerHotkey: () => ({ withGroup: vi.fn() }),
}));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
}));
vi.mock('@entity/utils/notification', () => ({
  notificationIsRead: (notification: { state: string }) =>
    notification.state !== 'unseen',
}));
vi.mock('@notifications/notification-helpers', () => ({
  ensureNotificationSourceLoaded: vi.fn(),
}));
vi.mock('@queries/channel/notification-selection', () => ({
  hydrateChannelNotificationSelection: mocks.hydrate,
}));
vi.mock('@queries/channel/selection-by-id', () => ({
  fetchChannelSelectionById: mocks.fetchChannel,
}));
vi.mock('@queries/channel-labels/channel-labels', () => ({
  useChannelLabelsQuery: () => ({ isSuccess: false }),
  useCreateChannelLabelMutation: () => ({}),
  useDeleteChannelLabelMutation: () => ({}),
  useRenameChannelLabelMutation: () => ({}),
  useSetChannelLabelMutation: () => ({}),
}));
vi.mock('@queries/favorites/favorites', () => ({
  useFavoritesData: () => () => ({ favorites: [] }),
}));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => ({ isSuccess: false }),
}));
vi.mock('@thisbeyond/solid-dnd', () => ({
  useDragDropContext: () => undefined,
}));
vi.mock('@ui', () => ({ confirmDialog: vi.fn() }));
vi.mock('../../channels-view-context', () => ({
  useChannelsView: () => ({
    state: {
      tab: 'browse',
      expandedGroups: { channels: true, direct_messages: true },
      collapsedLabels: [],
    },
    selectedChannel: () => mocks.selected,
    setSelectedChannel: mocks.select,
  }),
}));
vi.mock('../../queries', () => ({
  deduplicateChannels: (collections: ChannelEntity[][]) => [
    ...new Map(
      collections.flat().map((channel) => [channel.id, channel])
    ).values(),
  ],
  useChannelsByIdsQuery: () => ({ isEnabled: false }),
}));
vi.mock('./ChannelLabelNameDialog', () => ({ promptLabelName: vi.fn() }));
vi.mock('./SmartTagDialog', () => ({ promptSmartTag: vi.fn() }));
vi.mock('./hooks/useChannelCalls', () => ({ useChannelCalls: () => ({}) }));
vi.mock('./hooks/useChannelRailActivity', () => ({
  useChannelRailActivity: () => ({}),
}));
vi.mock('./ExpandedChannelsRail', () => ({
  ExpandedChannelsRail: () => (
    <button onClick={(event) => mocks.activate(event)}>
      Open conversation
    </button>
  ),
}));

import { ChannelsRail } from './ChannelsRail';

const channel: ChannelEntity = {
  id: 'one',
  type: 'channel',
  name: 'One',
  ownerId: 'owner',
  channelType: 'private',
  isParticipant: true,
  unreadNotifications: [
    { id: 'witness', state: 'unseen', createdAt: '2026-01-01' },
  ],
};
const hydrated: WithNotification<ChannelEntity> = {
  ...channel,
  unreadNotifications: undefined,
  notifications: () => [],
};
const source = {
  items: () => [channel],
  isLoading: () => false,
  isFetching: () => false,
  error: () => undefined,
  hasMore: () => false,
  isLoadingMore: () => false,
  loadMore: async () => {},
  refresh: async () => {},
};
const sources: ChannelsSources = {
  channels: source,
  direct_messages: source,
  recents: source,
  search: source,
};
const mount = () =>
  render(() => (
    <ChannelsRail
      sources={sources}
      searchQuery=""
      onSearchQueryChange={() => {}}
      searchOpen={false}
      onSearchOpenChange={() => {}}
    />
  ));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.row = channel;
  mocks.favoriteId = undefined;
  mocks.selected = { type: 'channel', id: channel.id };
  mocks.select.mockReturnValue(true);
  mocks.hydrate.mockReturnValue(hydrated);
});
afterEach(cleanup);

describe('explicit channel activation read marking', () => {
  it('resolves an uncached favorite before opening a split with top-level read marking', async () => {
    mocks.favoriteId = 'uncached';
    let resolve!: (channel: ChannelEntity) => void;
    mocks.fetchChannel.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    mount();
    fireEvent.click(screen.getByRole('button'), { shiftKey: true });
    expect(mocks.fetchChannel).toHaveBeenCalledExactlyOnceWith('uncached');
    expect(mocks.openSplit).not.toHaveBeenCalled();
    const full = { ...hydrated, id: 'uncached' };
    resolve(full);
    await waitFor(() =>
      expect(mocks.openSplit).toHaveBeenCalledExactlyOnceWith(full, {
        openInNewSplit: true,
        referredFrom: 'channels',
        notificationSource: mocks.source,
        channelNavigation: 'latest',
        channelReadScope: 'top-level',
      })
    );
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('discards a pending favorite split when another uncached favorite is selected', async () => {
    mocks.favoriteId = 'uncached';
    let resolve!: (channel: ChannelEntity) => void;
    mocks.fetchChannel.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    mount();
    fireEvent.click(screen.getByRole('button'), { shiftKey: true });
    mocks.favoriteId = 'another';
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith({
      type: 'channel',
      id: 'another',
    });
    resolve({ ...hydrated, id: 'uncached' });
    await Promise.resolve();
    expect(mocks.openSplit).not.toHaveBeenCalled();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('does not open an unavailable uncached favorite or mark notifications read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.favoriteId = 'uncached';
      mocks.fetchChannel.mockRejectedValueOnce(
        new Error('Conversation is unavailable')
      );
      mount();
      fireEvent.click(screen.getByRole('button'), { shiftKey: true });
      await waitFor(() => expect(mocks.failure).toHaveBeenCalledOnce());
      expect(mocks.openSplit).not.toHaveBeenCalled();
      expect(mocks.markRead).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('selects a different channel immediately and leaves hydration to the destination', () => {
    mocks.selected = { type: 'channel', id: 'previous' };
    mount();
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith({
      type: 'channel',
      id: channel.id,
    });
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('does not fetch or mark notifications when a channel switch is rejected', () => {
    mocks.selected = undefined;
    mocks.select.mockReturnValue(false);
    mount();
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('preserves an explicit search target when selecting before hydration', () => {
    mocks.selected = undefined;
    mocks.row = {
      ...channel,
      target: { messageId: 'reply', threadId: 'thread' },
    };
    mount();
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith({
      type: 'channel',
      id: channel.id,
      target: { messageId: 'reply', threadId: 'thread' },
    });
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });

  it('discards a pending re-click when another channel is selected', async () => {
    let resolve!: (channel: WithNotification<ChannelEntity>) => void;
    mocks.hydrate.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    mount();
    fireEvent.click(screen.getByRole('button'));
    mocks.row = { ...channel, id: 'two' };
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith({
      type: 'channel',
      id: 'two',
    });
    resolve(hydrated);
    await Promise.resolve();
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('marks the full channel on every accepted click, including the already-selected route', async () => {
    mocks.selected = { type: 'channel', id: channel.id };
    mount();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
        hydrated,
        mocks.source,
        { channelReadScope: 'top-level' }
      )
    );
    expect(mocks.navigate).toHaveBeenCalledOnce();
    const refreshed = { ...hydrated, notifications: () => [] };
    mocks.hydrate.mockReturnValue(refreshed);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(2));
    expect(mocks.markRead).toHaveBeenLastCalledWith(refreshed, mocks.source, {
      channelReadScope: 'top-level',
    });
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
  });

  it('awaits native async hydration when telemetry replaces the global Promise constructor', async () => {
    const NativePromise = globalThis.Promise;
    let resolve!: (channel: WithNotification<ChannelEntity>) => void;
    const pending = (async () =>
      await new NativePromise<WithNotification<ChannelEntity>>((done) => {
        resolve = done;
      }))();
    class InstrumentedPromise<T> extends NativePromise<T> {}
    vi.stubGlobal('Promise', InstrumentedPromise);
    mocks.hydrate.mockReturnValue(pending);
    try {
      expect(pending instanceof Promise).toBe(false);
      mount();
      fireEvent.click(screen.getByRole('button'));
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.markRead).not.toHaveBeenCalled();
      resolve(hydrated);
      await waitFor(() =>
        expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
          hydrated,
          mocks.source,
          { channelReadScope: 'top-level' }
        )
      );
    } finally {
      resolve(hydrated);
      await pending;
      vi.unstubAllGlobals();
    }
  });

  it('does not mark a rejected selection or a non-participant channel', () => {
    mount();
    mocks.select.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.markRead).not.toHaveBeenCalled();
    mocks.select.mockReturnValue(true);
    mocks.hydrate.mockReturnValue({ ...hydrated, isParticipant: false });
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('does not mark a superseded hydration; only the latest click is accepted', async () => {
    let resolve!: (channel: WithNotification<ChannelEntity>) => void;
    mocks.hydrate.mockReturnValueOnce(
      new Promise((value) => {
        resolve = value;
      })
    );
    mount();
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.markRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledOnce());
    resolve(hydrated);
    await Promise.resolve();
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.markRead).toHaveBeenCalledOnce();
  });

  it('hydrates shift-clicks and requests channel-wide marking in the split-open path', async () => {
    mount();
    fireEvent.click(screen.getByRole('button'), { shiftKey: true });
    await waitFor(() =>
      expect(mocks.openSplit).toHaveBeenCalledExactlyOnceWith(hydrated, {
        openInNewSplit: true,
        referredFrom: 'channels',
        notificationSource: mocks.source,
        channelNavigation: 'latest',
        channelReadScope: 'top-level',
      })
    );
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('reports hydration failures without marking or selecting a partial edge', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.hydrate.mockRejectedValueOnce(new Error('failed'));
    try {
      mount();
      fireEvent.click(screen.getByRole('button'));
      await waitFor(() => expect(mocks.failure).toHaveBeenCalledOnce());
      expect(mocks.markRead).not.toHaveBeenCalled();
      expect(mocks.select).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
