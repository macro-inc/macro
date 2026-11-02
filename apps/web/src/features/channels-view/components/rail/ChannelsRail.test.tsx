import type { ListScrollHandle } from '@app/components/list';
import type { ChannelPreviewSelection } from '@app/features/next-soup/utils';
import type { ChannelEntity } from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { getOwner, onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelsSources } from '../../queries';
import type { ChannelRailRow } from './ChannelsRailContext';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => mocks.userId,
}));
const mocks = vi.hoisted(() => ({
  fetchChannel: vi.fn<(id: string) => Promise<ChannelEntity>>(),
  favoriteId: undefined as string | undefined,
  fetchGroupIds:
    vi.fn<typeof import('../../queries')['fetchChannelGroupIds']>(),
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
  userId: 'viewer',
  source: {
    muteEntity:
      vi.fn<(entity: { type: string; id: string }) => Promise<void>>(),
    unmuteEntity:
      vi.fn<(entity: { type: string; id: string }) => Promise<void>>(),
  },
  snooze: vi.fn(),
  success: vi.fn(),
  activate: (_event: MouseEvent) => {},
  row: undefined as ChannelEntity | undefined,
  failure: vi.fn(),
  prefetch: vi.fn(),
  tab: 'browse' as 'browse' | 'threads',
  scrollBrowse: vi.fn(),
  scroll: (_index: number) => {},
  focusedRow: undefined as ChannelRailRow | undefined,
  listRows: undefined as ChannelRailRow[] | undefined,
  focusSet: vi.fn(),
  hotkeys: new Map<string, () => unknown>(),
}));
vi.mock('@app/components/list', () => ({
  createListController: (options: {
    items: () => ChannelRailRow[];
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
    const items = () => mocks.listRows ?? options.items();

    return {
      items: { at: (index: number) => items()[index], all: items },
      focus: {
        item: () => mocks.focusedRow,
        set: (id: string, options: { reason: string }) => {
          mocks.focusSet(id, options);
          const index = items().findIndex((row) => row.id === id);
          return index < 0 ? undefined : { index };
        },
      },
    };
  },
  listOwnedSlotName: (name: string) => name,
  useListInteractions: (options: { scrollHandle: () => ListScrollHandle }) => {
    mocks.scroll = (index) => options.scrollHandle().scrollToIndex(index);
  },
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
  toast: { failure: mocks.failure, success: mocks.success },
}));
vi.mock('@core/constant/featureFlags', () => ({ enableChannelTags: {} }));
vi.mock('@channel/queries/prefetch-channel-target', () => ({
  prefetchLatestChannelMessages: mocks.prefetch,
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  createHotkeyGroup: () => ({ dispose: vi.fn() }),
  registerHotkey: (options: {
    hotkey: string;
    keyDownHandler: () => unknown;
  }) => {
    mocks.hotkeys.set(options.hotkey, options.keyDownHandler);
    return { withGroup: vi.fn() };
  },
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
vi.mock('@notifications/SnoozeNotificationsDialog', () => ({
  openSnoozeNotifications: mocks.snooze,
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
      sectionPreferences: {},
    },
    tab: () => mocks.tab,
    sectionsEnabled: () => true,
    threadsEnabled: () => false,
    selectedChannel: () => mocks.selected,
    setSelectedChannel: mocks.select,
  }),
}));
vi.mock('../../queries', () => ({
  fetchChannelGroupIds: mocks.fetchGroupIds,
  deduplicateChannels: (collections: ChannelEntity[][]) => [
    ...new Map(
      collections.flat().map((channel) => [channel.id, channel])
    ).values(),
  ],
  useChannelsByIdsQuery: () => ({ isEnabled: false }),
  // What the real helper answers for the disabled lookup above.
  resolveReferencedChannels: (previous: ChannelEntity[]) => previous,
}));
vi.mock('@queries/channel/by-ids', () => ({
  useChannelsByIdsQuery: () => ({ isEnabled: false }),
  useCachedChannelsByIds: () => ({
    channels: () => [],
    pendingIds: () => new Set<string>(),
    failedIds: () => new Set<string>(),
    error: () => undefined,
    isLoading: () => false,
    retry: async () => {},
  }),
}));
vi.mock('./next/SectionDialog', () => ({ promptSection: vi.fn() }));
vi.mock('./ChannelLabelNameDialog', () => ({
  promptLabelName: vi.fn(),
}));
vi.mock('./SmartTagDialog', () => ({ promptSmartTag: vi.fn() }));
vi.mock('./ExpandedChannelsRail', () => ({ ExpandedChannelsRail: () => null }));
vi.mock('./hooks/useChannelCalls', () => ({ useChannelCalls: () => ({}) }));
vi.mock('./hooks/useChannelRailActivity', () => ({
  useChannelRailActivity: () => ({ unreadChannelIds: () => new Set<string>() }),
}));
vi.mock('./next/ExpandedChannelsRail', async () => {
  const { useChannelsRail } = await import('./ChannelsRailContext');
  return {
    ExpandedChannelsRail: () => {
      const rail = useChannelsRail();
      onCleanup(
        rail.registerBrowseScrollHandle({ scrollToIndex: mocks.scrollBrowse })
      );
      return (
        <button
          onPointerDown={(event) => rail.prefetchRow('channel:one', event)}
          onClick={(event) => mocks.activate(event)}
        >
          Open conversation
        </button>
      );
    },
  };
});

import { ChannelsRail } from './ChannelsRail';
import { useChannelSectionNotifications } from './hooks/useChannelSectionNotifications';

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
  items: () => [mocks.row ?? channel],
  isLoading: () => false,
  isFetching: () => false,
  error: () => undefined,
  hasMore: () => false,
  isLoadingMore: () => false,
  loadMore: async () => {},
  refresh: async () => {},
};
const sources: ChannelsSources = {
  team_channels: { ...source, items: () => [] },
  channels: source,
  direct_messages: source,
  recents: source,
  search: source,
  threads: source,
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
  mocks.focusedRow = undefined;
  mocks.listRows = undefined;
  mocks.hotkeys.clear();
  mocks.userId = 'viewer';
  mocks.source.muteEntity.mockResolvedValue(undefined);
  mocks.source.unmuteEntity.mockResolvedValue(undefined);
  mocks.fetchGroupIds.mockReset();
  mocks.fetchGroupIds.mockResolvedValue(['one', 'unloaded']);
  mocks.row = channel;
  mocks.favoriteId = undefined;
  mocks.tab = 'browse';
  mocks.selected = { type: 'channel', id: channel.id };
  mocks.select.mockReturnValue(true);
  mocks.hydrate.mockReturnValue(hydrated);
});
afterEach(cleanup);

it('delegates keyboard scrolling to the sectioned renderer instead of global indexes', () => {
  mount();
  mocks.scroll(0);
  expect(mocks.scrollBrowse).toHaveBeenCalledExactlyOnceWith(0, undefined);
});

describe('section heading navigation', () => {
  it.each([
    ['label:first', ']', 'label:second'],
    ['label:second', '[', 'label:first'],
    ['section:team_channels', ']', 'section:channels'],
    ['channel:one:label:first', ']', 'label:second'],
  ])('jumps from %s with %s to %s', (from, hotkey, to) => {
    const first: ChannelLabel = {
      id: 'first',
      name: 'First',
      channelIds: ['one'],
      channelCount: 1,
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    mocks.listRows = [
      { kind: 'section', id: 'section:team_channels', group: 'team_channels' },
      { kind: 'section', id: 'section:channels', group: 'channels' },
      {
        kind: 'label',
        id: 'label:first',
        group: 'team_channels',
        localIndex: 2,
        label: first,
      },
      {
        kind: 'conversation',
        id: 'channel:one:label:first',
        group: 'team_channels',
        scope: 'team_channels',
        localIndex: 3,
        channel,
        labelId: 'first',
      },
      {
        kind: 'label',
        id: 'label:second',
        group: 'team_channels',
        localIndex: 4,
        label: { ...first, id: 'second', name: 'Second' },
      },
    ];
    mocks.focusedRow = mocks.listRows.find((row) => row.id === from);
    mount();

    expect(mocks.hotkeys.get(hotkey)?.()).toBe(true);
    expect(mocks.focusSet).toHaveBeenCalledExactlyOnceWith(to, {
      reason: 'keyboard',
    });
    expect(mocks.scrollBrowse).toHaveBeenCalledExactlyOnceWith(
      mocks.listRows.findIndex((row) => row.id === to),
      undefined
    );
  });
});

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

  it.each([false, true])(
    'ignores superseded hydration (shift-click: %s)',
    async (shiftKey) => {
      let resolve!: (channel: WithNotification<ChannelEntity>) => void;
      mocks.hydrate.mockReturnValueOnce(
        new Promise((value) => {
          resolve = value;
        })
      );
      mount();
      fireEvent.click(screen.getByRole('button'), { shiftKey });
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.openSplit).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button'));
      await waitFor(() => expect(mocks.select).toHaveBeenCalledOnce());
      resolve(hydrated);
      await Promise.resolve();
      expect(mocks.select).toHaveBeenCalledOnce();
      expect(mocks.openSplit).not.toHaveBeenCalled();
      expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
        hydrated,
        mocks.source,
        { channelReadScope: 'top-level' }
      );
    }
  );

  it('hydrates shift-clicks and opens at latest with top-level read marking', async () => {
    let resolve!: (channel: WithNotification<ChannelEntity>) => void;
    mocks.hydrate.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    mount();
    fireEvent.click(screen.getByRole('button'), { shiftKey: true });
    expect(mocks.openSplit).not.toHaveBeenCalled();
    resolve(hydrated);
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

  it.each([false, true])(
    'reports hydration failures without opening a partial edge (shift-click: %s)',
    async (shiftKey) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.hydrate.mockRejectedValueOnce(new Error('failed'));
      try {
        mount();
        fireEvent.click(screen.getByRole('button'), { shiftKey });
        await waitFor(() => expect(mocks.failure).toHaveBeenCalledOnce());
        expect(mocks.markRead).not.toHaveBeenCalled();
        expect(mocks.select).not.toHaveBeenCalled();
        expect(mocks.openSplit).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    }
  );
});

describe('channel row presses', () => {
  // jsdom has no PointerEvent, so a press is a MouseEvent tagged as one.
  const press = (init: { pointerType: string; button: number }) => {
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      button: init.button,
    });
    Object.defineProperty(event, 'pointerType', { value: init.pointerType });
    screen.getByRole('button').dispatchEvent(event);
  };

  it('starts the latest messages on a primary mouse press', () => {
    mount();
    press({ pointerType: 'mouse', button: 0 });
    expect(mocks.prefetch).toHaveBeenCalledExactlyOnceWith('one');
  });

  it('leaves touch presses, other buttons, and the Threads tab alone', () => {
    mount();
    press({ pointerType: 'touch', button: 0 });
    press({ pointerType: 'mouse', button: 2 });
    cleanup();
    mocks.tab = 'threads';
    mount();
    press({ pointerType: 'mouse', button: 0 });
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });

  it('leaves a row that opens at a message to the target prefetch', () => {
    mocks.row = { ...channel, target: { messageId: 'message' } };
    mount();
    press({ pointerType: 'mouse', button: 0 });
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });
});

describe('section notification actions', () => {
  const label: ChannelLabel = {
    id: 'section',
    name: 'Section',
    channelIds: ['one', 'unloaded', 'one'],
    channelCount: 2,
    sortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };

  const mountActions = (
    labels: () => ChannelLabel[] = () => [label],
    enabled: () => boolean = () => true,
    favorites: () => Favorite[] = () => []
  ) => {
    let actions!: ReturnType<typeof useChannelSectionNotifications>;

    render(() => {
      const owner = getOwner();
      actions = useChannelSectionNotifications({
        enabled,
        labelsAvailable: enabled,
        labels,
        favorites,
        dialogOwner: () => owner,
      });
      return null;
    });

    return actions;
  };

  it('uses the complete current membership instead of loaded rows or a stale snapshot', async () => {
    let current = label;
    const actions = mountActions(() => [current]);

    await actions.muteSection('label:section', true);

    expect(mocks.source.muteEntity.mock.calls).toEqual([
      [{ type: 'channel', id: 'one' }],
      [{ type: 'channel', id: 'unloaded' }],
    ]);

    current = { ...label, channelIds: ['new-member'] };
    await actions.snoozeSection('label:section');

    expect(mocks.snooze).toHaveBeenCalledWith(
      [{ item_type: 'channel', item_id: 'new-member' }],
      { owner: expect.anything() }
    );
  });

  it('keeps successful writes when one member fails and blocks duplicate actions until settled', async () => {
    let finish!: () => void;
    mocks.source.muteEntity
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
    const actions = mountActions();

    const pending = actions.muteSection('label:section', true);
    expect(actions.sectionNotificationsDisabled('label:section')).toBe(true);

    await actions.muteSection('label:section', false);
    await actions.snoozeSection('label:section');

    expect(mocks.source.muteEntity).toHaveBeenCalledTimes(2);
    expect(mocks.source.unmuteEntity).not.toHaveBeenCalled();
    expect(mocks.snooze).not.toHaveBeenCalled();

    finish();
    await pending;

    expect(actions.sectionNotificationsDisabled('label:section')).toBe(false);
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith(
      'Muted 1 of 2 items; 1 failed'
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('unmutes all current members without changing section membership', async () => {
    const actions = mountActions();
    await actions.muteSection('label:section', false);

    expect(mocks.source.unmuteEntity.mock.calls).toEqual([
      [{ type: 'channel', id: 'one' }],
      [{ type: 'channel', id: 'unloaded' }],
    ]);
    expect(label.channelIds).toEqual(['one', 'unloaded', 'one']);
  });

  it('refuses disabled or deleted sections', async () => {
    let enabled = false;
    let current = [label];
    const actions = mountActions(
      () => current,
      () => enabled
    );

    await actions.muteSection('label:section', true);
    await actions.snoozeSection('label:section');

    enabled = true;
    current = [];

    await actions.muteSection('label:section', true);
    await actions.snoozeSection('label:section');

    expect(mocks.source.muteEntity).not.toHaveBeenCalled();
    expect(mocks.snooze).not.toHaveBeenCalled();
  });

  it('does not block a new account or clear its pending action when an older batch finishes', async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    mocks.source.muteEntity
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishSecond = resolve;
          })
      );

    let current = { ...label, channelIds: ['one'] };
    const actions = mountActions(() => [current]);
    const first = actions.muteSection('label:section', true);

    mocks.userId = 'another-viewer';
    current = { ...label, channelIds: ['two'] };

    expect(actions.sectionNotificationsDisabled('label:section')).toBe(false);
    const second = actions.muteSection('label:section', true);
    expect(mocks.source.muteEntity.mock.calls).toEqual([
      [{ type: 'channel', id: 'one' }],
      [{ type: 'channel', id: 'two' }],
    ]);

    finishFirst();
    await first;

    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.failure).not.toHaveBeenCalled();
    expect(actions.sectionNotificationsDisabled('label:section')).toBe(true);

    finishSecond();
    await second;

    expect(actions.sectionNotificationsDisabled('label:section')).toBe(false);
    expect(mocks.success).toHaveBeenCalledOnce();
  });

  it('targets channel favorites without loading rows or touching other favorite types', async () => {
    const favorites: Favorite[] = [
      {
        entityType: 'channel',
        entityId: 'unloaded',
        createdAt: '2026-01-01',
        sortOrder: 0,
      },
      {
        entityType: 'document',
        entityId: 'document',
        createdAt: '2026-01-01',
        sortOrder: 1,
      },
    ];
    const actions = mountActions(
      () => [],
      () => true,
      () => favorites
    );

    await actions.muteSection('favorites', true);
    await actions.snoozeSection('favorites');

    expect(mocks.source.muteEntity).toHaveBeenCalledExactlyOnceWith({
      type: 'channel',
      id: 'unloaded',
    });
    expect(mocks.snooze).toHaveBeenCalledWith(
      [{ item_type: 'channel', item_id: 'unloaded' }],
      { owner: expect.anything() }
    );
    expect(mocks.fetchGroupIds).not.toHaveBeenCalled();
  });

  it.each(['channels', 'team_channels', 'direct_messages'] as const)(
    'resolves complete %s membership before applying notification updates',
    async (section) => {
      const actions = mountActions();
      await actions.muteSection(section, false);

      expect(mocks.fetchGroupIds).toHaveBeenCalledExactlyOnceWith(
        section,
        section === 'channels' ? label.channelIds : [],
        expect.any(AbortSignal)
      );
      expect(mocks.source.unmuteEntity.mock.calls).toEqual([
        [{ type: 'channel', id: 'one' }],
        [{ type: 'channel', id: 'unloaded' }],
      ]);
    }
  );

  it.each(['account', 'unmount'] as const)(
    'discards membership resolved after %s changes',
    async (change) => {
      let resolve!: (ids: string[]) => void;
      mocks.fetchGroupIds.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      const actions = mountActions();
      const pending = actions.snoozeSection('team_channels');
      expect(actions.sectionNotificationsDisabled('favorites')).toBe(true);

      if (change === 'account') {
        mocks.userId = 'another-viewer';
      } else {
        cleanup();
      }

      resolve(['unloaded']);
      await pending;

      expect(mocks.snooze).not.toHaveBeenCalled();
      expect(mocks.source.muteEntity).not.toHaveBeenCalled();
    }
  );

  it('keeps the section retryable after membership lookup fails without applying partial updates', async () => {
    const error = new Error('offline');
    mocks.fetchGroupIds.mockRejectedValueOnce(error);
    const actions = mountActions();

    await expect(actions.muteSection('team_channels', true)).rejects.toThrow(
      error
    );

    expect(actions.sectionNotificationsDisabled('team_channels')).toBe(false);
    expect(mocks.source.muteEntity).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledOnce();

    await actions.muteSection('team_channels', true);
    expect(mocks.source.muteEntity).toHaveBeenCalledTimes(2);
  });
});
