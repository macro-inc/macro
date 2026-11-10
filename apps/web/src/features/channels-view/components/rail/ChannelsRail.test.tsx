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
import { createSignal, getOwner, type JSX, onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelsSources } from '../../queries';
import type { ChannelRailRow, SectionDraft } from './ChannelsRailContext';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => mocks.userId,
}));
const mocks = vi.hoisted(() => ({
  fetchChannel: vi.fn<(id: string) => Promise<ChannelEntity>>(),
  bulkPreferences: vi.fn(),
  favoriteId: undefined as string | undefined,
  favorites: [] as Favorite[],
  referencedChannels: [] as ChannelEntity[],
  sectionsEnabled: true,
  unreadRows: [] as ChannelEntity[],
  closedGroups: [] as string[],
  actualRows: (): ChannelRailRow[] => [],
  activityChannels: (): readonly ChannelEntity[] => [],
  additionalActivityChannels: (): readonly ChannelEntity[] => [],
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
  onNavigate: (_event: { result?: { item: ChannelRailRow } }) => {},
  focusRailRow: (_channelId: string): boolean => false,
  shell: {
    collapsed: false,
    canCollapse: true,
    expand: vi.fn(),
  },
  hotkeys: new Map<string, () => unknown>(),
  realRenderer: false,
  sectionDraft: undefined as (() => SectionDraft | undefined) | undefined,
}));
vi.mock('@app/components/list', () => ({
  createListController: (options: {
    items: () => ChannelRailRow[];
    onActivate: (event: {
      item: ChannelRailRow;
      metadata: { event: MouseEvent };
    }) => void;
  }) => {
    mocks.actualRows = options.items;
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
      activate: {
        key: (id: string, activation: { metadata: { event: MouseEvent } }) => {
          const item = items().find((row) => row.id === id);
          if (item) options.onActivate({ item, metadata: activation.metadata });
        },
      },
      focus: {
        item: () => mocks.focusedRow,
        key: () => undefined,
        set: (id: string, options: { reason: string }) => {
          mocks.focusSet(id, options);
          const index = items().findIndex((row) => row.id === id);
          return index < 0 ? undefined : { index };
        },
      },
    };
  },
  listOwnedSlotName: (name: string) => name,
  useListInteractions: (options: {
    scrollHandle: () => ListScrollHandle;
    navigation: {
      onNavigate: (event: { result?: { item: ChannelRailRow } }) => void;
    };
  }) => {
    mocks.scroll = (index) => options.scrollHandle().scrollToIndex(index);
    mocks.onNavigate = options.navigation.onNavigate;
  },
}));
vi.mock('@app/components/view-shell', () => ({
  ViewSidebar: {
    Header: (props: { children: JSX.Element }) => <div>{props.children}</div>,
    Primary: (props: { children: JSX.Element }) => <div>{props.children}</div>,
    CloseButton: () => null,
    Title: (props: { children: JSX.Element }) => <span>{props.children}</span>,
  },
  SearchBar: () => null,
  useViewControlHotkeys: vi.fn(),
  useViewTabHotkeys: vi.fn(),
  useViewShell: () => ({
    aside: {
      isCollapsed: () => mocks.shell.collapsed,
      canCollapse: () => mocks.shell.canCollapse,
      expand: mocks.shell.expand,
    },
  }),
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
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  enableChannelTags: {},
}));
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
vi.mock('@queries/notification/unsubscribes', () => ({
  useBulkNotificationPreferencesMutation: () => ({
    mutateAsync: mocks.bulkPreferences,
  }),
}));
vi.mock('@queries/channel-labels/channel-labels', () => ({
  useChannelLabelsQuery: () => ({ isSuccess: false }),
  useAvailableSectionChannelsQuery: () => ({
    isPending: false,
    isError: false,
    data: [],
  }),
  useCreateChannelLabelMutation: () => ({}),
  useDeleteChannelLabelMutation: () => ({}),
  useRenameChannelLabelMutation: () => ({}),
  useSetChannelLabelMutation: () => ({}),
}));
vi.mock('@queries/favorites/favorites', () => ({
  useFavoritesData: () => () => ({ favorites: mocks.favorites }),
  useReorderFavoritesMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => ({ isSuccess: false }),
}));
vi.mock('@thisbeyond/solid-dnd', () => ({
  createDroppable: () => ({ ref: () => {}, isActiveDroppable: false }),
  useDragDropContext: () => undefined,
}));
vi.mock('@ui', () => ({ confirmDialog: vi.fn() }));
vi.mock('../../channels-view-context', () => ({
  useChannelsView: () => ({
    state: {
      tab: 'browse',
      expandedGroups: {
        get channels() {
          return !mocks.closedGroups.includes('channels');
        },
        get team_channels() {
          return !mocks.closedGroups.includes('team_channels');
        },
        get direct_messages() {
          return !mocks.closedGroups.includes('direct_messages');
        },
      },
      collapsedLabels: [],
      sectionPreferences: {},
      sortBy: {
        channels: 'viewed_at',
        team_channels: 'viewed_at',
        direct_messages: 'viewed_at',
        threads: 'viewed_at',
      },
    },
    tab: () => mocks.tab,
    sectionsEnabled: () => mocks.sectionsEnabled,
    threadsEnabled: () => false,
    selectedChannel: () => mocks.selected,
    setSelectedChannel: mocks.select,
    registerRailRowFocus: (focus: (channelId: string) => boolean) => {
      mocks.focusRailRow = focus;
    },
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
  resolveReferencedChannels: () => mocks.referencedChannels,
}));
vi.mock('@queries/channel/by-ids', () => ({
  useChannelsByIdsQuery: () => ({ isEnabled: false }),
  useCachedChannelsByIds: () => ({
    channels: () => mocks.referencedChannels,
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
  useChannelRailActivity: (
    channels: () => readonly ChannelEntity[],
    _calls: unknown,
    additionalChannels: () => readonly ChannelEntity[] = () => []
  ) => {
    mocks.activityChannels = channels;
    mocks.additionalActivityChannels = additionalChannels;
    return {
      unreadChannelIds: () =>
        new Set(
          channels()
            .filter((channel) =>
              channel.unreadNotifications?.some(
                (notification) => notification.state === 'unseen'
              )
            )
            .map((channel) => channel.id)
        ),
    };
  },
}));
vi.mock('./next/collapsed-unread-channels', () => ({
  useCollapsedUnreadChannels: (enabled: () => boolean) => () =>
    enabled() ? mocks.unreadRows : [],
}));
vi.mock('./next/ExpandedChannelsRail', async (importOriginal) => {
  const { ExpandedChannelsRail: RealRenderer } =
    await importOriginal<typeof import('./next/ExpandedChannelsRail')>();
  const { useChannelsRail } = await import('./ChannelsRailContext');
  return {
    ExpandedChannelsRail: (props: Parameters<typeof RealRenderer>[0]) => {
      if (mocks.realRenderer) {
        const rail = useChannelsRail();
        if (mocks.sectionDraft) rail.sectionDraft = mocks.sectionDraft;
        return <RealRenderer {...props} />;
      }
      const rail = useChannelsRail();
      onCleanup(
        rail.registerBrowseScrollHandle({ scrollToIndex: mocks.scrollBrowse })
      );
      return (
        <div ref={rail.registerRootRef} tabIndex={-1} data-testid="rail">
          <button
            onPointerDown={(event) => rail.prefetchRow('channel:one', event)}
            onClick={(event) => mocks.activate(event)}
          >
            Open conversation
          </button>
        </div>
      );
    },
  };
});
vi.mock('./next/InlineSectionDraft', () => ({
  InlineSectionDraft: () => <div data-inline-section-draft />,
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({}),
  useUserTeamsQuery: () => ({}),
}));
vi.mock('@ui/components/Tour', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui/components/Tour')>()),
  tourTarget: () => () => {},
}));
vi.mock('./next/ChannelFavoriteRow', () => ({
  ChannelFavoriteRow: () => null,
}));
vi.mock('./next/ChannelSectionEmptyState', () => ({
  ChannelSectionEmptyState: () => null,
}));
vi.mock('./next/ChannelLabelRows', () => ({
  ChannelLabelEmptyState: () => null,
  ChannelLabelRow: () => null,
}));
// Keep the section layout and virtualizer real; isolate unrelated menus and decoration.
vi.mock('./next/ResizableRailSection', () => ({
  ResizableRailSection: (props: {
    header: JSX.Element;
    children: JSX.Element;
    rootRef: (element: HTMLDivElement) => void;
    scrollRef: (element: HTMLDivElement) => void;
  }) => (
    <div ref={props.rootRef}>
      {props.header}
      <div ref={props.scrollRef}>{props.children}</div>
    </div>
  ),
}));
vi.mock('./next/ChannelSectionDropZone', () => ({
  ChannelSectionDropZone: (props: { children: JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));
vi.mock('./next/ChannelSectionHeading', () => ({
  ChannelSectionHeading: () => <div />,
  DraggableChannelSectionHeading: (props: { children: JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));
vi.mock('./next/ChannelSectionMenu', () => ({
  ChannelSectionContextMenu: (props: { children: JSX.Element }) => (
    <div>{props.children}</div>
  ),
  ChannelSectionDropdown: () => null,
}));
vi.mock('./ChannelOption', async () => {
  const { useChannelsRail } = await import('./ChannelsRailContext');
  return {
    ChannelOption: (props: {
      channel: ChannelEntity;
      rowId: ChannelRailRow['id'];
    }) => {
      const rail = useChannelsRail();
      return (
        <button
          type="button"
          onPointerDown={(event) => rail.prefetchRow(props.rowId, event)}
          onClick={(event) => rail.activateRow(props.rowId, event)}
        >
          {props.channel.name}
        </button>
      );
    },
  };
});
vi.mock('@app/components/drag-drop/create-drag-auto-scroll', () => ({
  createDragAutoScroll: () => {},
}));
vi.mock('@app/components/drag-drop/create-layout-animation', () => ({
  createLayoutAnimation: () => ({
    cancel: () => {},
    beginHover: () => () => {},
  }),
}));
vi.mock('@core/util/createScrollTopFade', () => ({
  createScrollTopFade: () => {},
}));
vi.mock('../../live-calls-sidebar', () => ({
  ChannelsLiveCallsSidebar: () => null,
}));
vi.mock('@app/features/slack-import/slack-import-sidebar', () => ({
  SlackImportSidebar: () => null,
}));
vi.mock('../ConversationsCreateMenu', () => ({
  ConversationsCreateMenu: () => null,
}));

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
  mocks.realRenderer = false;
  mocks.sectionDraft = undefined;
  mocks.focusedRow = undefined;
  mocks.favorites = [];
  mocks.referencedChannels = [];
  mocks.sectionsEnabled = true;
  mocks.unreadRows = [];
  mocks.closedGroups = [];
  mocks.listRows = undefined;
  mocks.hotkeys.clear();
  mocks.userId = 'viewer';
  mocks.source.muteEntity.mockResolvedValue(undefined);
  mocks.source.unmuteEntity.mockResolvedValue(undefined);
  mocks.bulkPreferences.mockImplementation(
    async (args: {
      items: { item_type: string; item_id: string }[];
      muted: boolean;
    }) => {
      const results = await Promise.allSettled(
        args.items.map((item) => {
          const entity = { type: item.item_type, id: item.item_id };
          return args.muted
            ? mocks.source.muteEntity(entity)
            : mocks.source.unmuteEntity(entity);
        })
      );
      return {
        succeeded: args.items.filter(
          (_, index) => results[index].status === 'fulfilled'
        ),
        failed: args.items.filter(
          (_, index) => results[index].status === 'rejected'
        ),
      };
    }
  );
  mocks.fetchGroupIds.mockReset();
  mocks.fetchGroupIds.mockResolvedValue(['one', 'unloaded']);
  mocks.row = channel;
  mocks.favoriteId = undefined;
  mocks.tab = 'browse';
  mocks.selected = { type: 'channel', id: channel.id };
  mocks.select.mockReturnValue(true);
  mocks.hydrate.mockReturnValue(hydrated);
  mocks.shell.collapsed = false;
  mocks.shell.canCollapse = true;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.modality;
});

it.each([false, true])(
  'tracks unread activity for favorites outside loaded channel pages with sections enabled: %s',
  (enabled) => {
    mocks.sectionsEnabled = enabled;
    mocks.favorites = [
      {
        entityId: 'outside-page',
        entityType: 'channel',
        createdAt: '2026-01-01',
        sortOrder: 0,
      },
    ];
    mocks.referencedChannels = [{ ...channel, id: 'outside-page' }];

    mount();

    expect(mocks.additionalActivityChannels().map(({ id }) => id)).toContain(
      'outside-page'
    );
    expect(
      mocks.activityChannels().some(({ id }) => id === 'outside-page')
    ).toBe(enabled);
  }
);

it.each([false, true])(
  'shows off-page unread channels in collapsed sections only with the flag enabled: %s',
  (enabled) => {
    mocks.sectionsEnabled = enabled;
    mocks.closedGroups = ['team_channels'];
    mocks.unreadRows = [
      { ...channel, id: 'outside-page', channelType: 'team' },
    ];
    mount();
    const conversations = mocks
      .actualRows()
      .filter((row) => row.kind === 'conversation');
    expect(conversations.some((row) => row.channel.id === 'outside-page')).toBe(
      enabled
    );
  }
);

it('delegates keyboard scrolling to the sectioned renderer instead of global indexes', () => {
  mount();
  mocks.scroll(0);
  expect(mocks.scrollBrowse).toHaveBeenCalledExactlyOnceWith(0, undefined);
});

it.each(['team_channels', 'channels'] as const)(
  'keeps a pressed %s row attached through a live data refresh and activates once',
  async (scope) => {
    mocks.realRenderer = true;
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.parentElement;
      }
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute('data-index') ? 34 : 200;
      }
    );
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
    const observers: Array<{
      callback: ResizeObserverCallback;
      targets: Element[];
    }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        targets: Element[] = [];
        constructor(readonly callback: ResizeObserverCallback) {
          observers.push(this);
        }
        observe(target: Element) {
          this.targets.push(target);
        }
        unobserve(target: Element) {
          this.targets = this.targets.filter((item) => item !== target);
        }
        disconnect() {
          this.targets = [];
        }
      }
    );
    mocks.selected = undefined;
    const [channels, setChannels] = createSignal([channel]);
    const liveSources: ChannelsSources = {
      ...sources,
      team_channels: { ...source, items: () => [] },
      channels: { ...source, items: () => [] },
      [scope]: { ...source, items: channels },
      direct_messages: { ...source, items: () => [] },
    };
    const { container } = render(() => (
      <ChannelsRail
        sources={liveSources}
        searchQuery=""
        onSearchQueryChange={() => {}}
        searchOpen={false}
        onSearchOpenChange={() => {}}
      />
    ));
    for (let pass = 0; pass < 3; pass++) {
      await Promise.resolve();
      for (const observer of observers) {
        if (observer.targets.length === 0) continue;
        observer.callback(
          observer.targets.map((target) => ({
            target,
            contentRect: new DOMRect(
              0,
              0,
              300,
              target.hasAttribute('data-index') ? 34 : 200
            ),
            borderBoxSize: [
              {
                inlineSize: 300,
                blockSize: target.hasAttribute('data-index') ? 34 : 200,
              },
            ],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          })),
          observer as unknown as ResizeObserver
        );
      }
    }
    const row = screen.getByRole('button', { name: 'One' });
    fireEvent.pointerDown(row, { pointerType: 'mouse', button: 0 });
    setChannels([{ ...channel, name: 'One updated' }]);

    expect(screen.getByRole('button', { name: 'One updated' })).toBe(row);
    expect(container.contains(row)).toBe(true);
    fireEvent.pointerUp(row, { pointerType: 'mouse', button: 0 });
    fireEvent.click(row);
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(
      { type: 'channel', id: 'one', target: undefined },
      { focusComposer: true }
    );
  }
);

it('opens search over mounted section rows', async () => {
  mocks.realRenderer = true;
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.parentElement;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-index') ? 34 : 200;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const [searchOpen, setSearchOpen] = createSignal(false);
  render(() => (
    <ChannelsRail
      sources={{
        ...sources,
        team_channels: { ...source, items: () => [] },
        direct_messages: { ...source, items: () => [] },
        search: {
          ...source,
          items: () => [{ ...channel, id: 'found', name: 'Found' }],
        },
      }}
      searchQuery=""
      onSearchQueryChange={() => {}}
      searchOpen={searchOpen()}
      onSearchOpenChange={setSearchOpen}
    />
  ));
  await Promise.resolve();
  expect(screen.getByRole('button', { name: 'One' })).toBeTruthy();

  // Disposing the section rows must not rerun the sections being disposed.
  expect(() => setSearchOpen(true)).not.toThrow();
  await Promise.resolve();

  expect(screen.getByRole('button', { name: 'Found' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'One' })).toBeNull();
});

it('keeps nested rows aligned when the inline editor opens and changes height', async () => {
  mocks.realRenderer = true;
  vi.useFakeTimers();
  const [draft, setDraft] = createSignal<SectionDraft>();
  mocks.sectionDraft = draft;
  let draftHeight = 0;
  let prefix: Element | undefined;
  let stack: Element | undefined;
  const observers: ResizeObserver[] = [];
  const targets = new Map<ResizeObserver, Set<Element>>();
  const callbacks = new Map<ResizeObserver, ResizeObserverCallback>();
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observers.push(this);
        callbacks.set(this, callback);
        targets.set(this, new Set());
      }
      observe(target: Element) {
        targets.get(this)?.add(target);
      }
      unobserve(target: Element) {
        targets.get(this)?.delete(target);
      }
      disconnect() {
        targets.get(this)?.clear();
      }
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.parentElement;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(
    function (this: HTMLElement) {
      if (this === stack) return draftHeight;
      return this.hasAttribute('data-index')
        ? Number.parseFloat(this.style.top) || 0
        : 0;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      if (this === prefix) return draftHeight;
      if (this === stack) return 1700;
      if (this.hasAttribute('data-index'))
        return this.firstElementChild?.classList.contains('shrink-0')
          ? 1700
          : 34;
      return 200;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return new DOMRect(0, 0, 300, this.offsetHeight);
    }
  );
  mocks.listRows = [
    { kind: 'section', id: 'section:channels', group: 'channels' },
    ...Array.from(
      { length: 50 },
      (_, index): ChannelRailRow => ({
        kind: 'conversation',
        id: `channel:item-${index}`,
        group: 'channels',
        scope: 'channels',
        localIndex: index,
        channel: { ...channel, id: `item-${index}`, name: `Channel ${index}` },
      })
    ),
  ];
  const view = mount();
  const viewport = view.container.querySelector<HTMLDivElement>(
    '.scrollbar-hidden.overflow-y-auto'
  );
  if (!viewport) throw new Error('Missing sidebar viewport');
  prefix = viewport.firstElementChild ?? undefined;
  stack = viewport.lastElementChild ?? undefined;
  const measure = () => {
    for (const observer of observers) {
      const entries = [...(targets.get(observer) ?? [])].map((target) => ({
        target,
        contentRect: target.getBoundingClientRect(),
        borderBoxSize: [
          { inlineSize: 300, blockSize: target.getBoundingClientRect().height },
        ],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      }));
      if (entries.length) callbacks.get(observer)?.(entries, observer);
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    await Promise.resolve();
    measure();
    await vi.advanceTimersByTimeAsync(20);
  }
  viewport.scrollTop = 680;
  fireEvent.scroll(viewport);
  await vi.advanceTimersByTimeAsync(20);
  expect(screen.queryByRole('button', { name: 'Channel 12' })).toBeNull();

  draftHeight = 136;
  setDraft({ initialChannelIds: [], scope: 'personal' });
  measure();
  await vi.advanceTimersByTimeAsync(20);
  expect(screen.getByRole('button', { name: 'Channel 12' })).toBeTruthy();

  draftHeight = 68;
  measure();
  await vi.advanceTimersByTimeAsync(20);
  expect(screen.queryByRole('button', { name: 'Channel 10' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Channel 12' })).toBeTruthy();

  draftHeight = 0;
  setDraft(undefined);
  measure();
  await vi.advanceTimersByTimeAsync(20);
  expect(screen.queryByRole('button', { name: 'Channel 12' })).toBeNull();
});

describe('section heading navigation', () => {
  it.each([
    ['label:first', ']', 'label:second'],
    ['label:second', '[', 'label:first'],
    ['section:team_channels', ']', 'label:first'],
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
      {
        kind: 'label',
        id: 'label:first',
        group: 'team_channels',
        localIndex: 1,
        label: first,
      },
      {
        kind: 'conversation',
        id: 'channel:one:label:first',
        group: 'team_channels',
        scope: 'team_channels',
        localIndex: 2,
        channel,
        labelId: 'first',
      },
      {
        kind: 'label',
        id: 'label:second',
        group: 'team_channels',
        localIndex: 3,
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
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(
      { type: 'channel', id: 'another' },
      { focusComposer: true }
    );
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
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(
      { type: 'channel', id: channel.id },
      { focusComposer: true }
    );
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
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(
      {
        type: 'channel',
        id: channel.id,
        target: { messageId: 'reply', threadId: 'thread' },
      },
      { focusComposer: true }
    );
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
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(
      { type: 'channel', id: 'two' },
      { focusComposer: true }
    );
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

  it('ignores superseded hydration', async () => {
    let resolve!: (channel: WithNotification<ChannelEntity>) => void;
    mocks.hydrate.mockReturnValueOnce(
      new Promise((value) => {
        resolve = value;
      })
    );
    mount();
    fireEvent.click(screen.getByRole('button'));
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
  });

  it('opens a shift-click at latest without waiting for notifications', () => {
    mocks.hydrate.mockReturnValue(new Promise(() => {}));
    mount();
    fireEvent.click(screen.getByRole('button'), { shiftKey: true });
    expect(mocks.openSplit).toHaveBeenCalledExactlyOnceWith(channel, {
      openInNewSplit: true,
      referredFrom: 'channels',
      notificationSource: mocks.source,
      channelNavigation: 'latest',
      channelReadScope: 'top-level',
    });
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('reports hydration failures without marking a re-click read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.hydrate.mockRejectedValueOnce(new Error('failed'));
    try {
      mount();
      fireEvent.click(screen.getByRole('button'));
      await waitFor(() => expect(mocks.failure).toHaveBeenCalledOnce());
      expect(mocks.markRead).not.toHaveBeenCalled();
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.openSplit).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('composer focus on opening a conversation', () => {
  beforeEach(() => {
    mocks.selected = { type: 'channel', id: 'previous' };
  });

  it.each(['mouse', 'keyboard'])(
    'asks a conversation opened by %s for its composer focus',
    (modality) => {
      document.documentElement.dataset.modality = modality;
      mount();
      fireEvent.click(screen.getByRole('button'));
      expect(mocks.select).toHaveBeenCalledExactlyOnceWith(
        { type: 'channel', id: channel.id },
        { focusComposer: true }
      );
    }
  );

  it('asks the open conversation for its composer focus again', () => {
    mocks.selected = { type: 'channel', id: channel.id };
    document.documentElement.dataset.modality = 'keyboard';
    mount();
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(
      { type: 'channel', id: channel.id },
      { focusComposer: true }
    );
  });

  it('leaves the on-screen keyboard down after a tap', () => {
    document.documentElement.dataset.modality = 'touch';
    mount();
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(
      { type: 'channel', id: channel.id },
      { focusComposer: false }
    );
  });

  it('previews a conversation reached by arrowing without asking for focus', () => {
    vi.useFakeTimers();
    document.documentElement.dataset.modality = 'keyboard';
    mount();
    mocks.onNavigate({
      result: {
        item: {
          kind: 'conversation',
          id: 'channel:one',
          scope: 'channels',
          localIndex: 0,
          channel,
        },
      },
    });
    vi.advanceTimersByTime(150);
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(channel);
  });
});

describe('Esc back to the sidebar', () => {
  it('focuses the open conversation on its row', () => {
    mount();
    expect(mocks.focusRailRow(channel.id)).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId('rail'));
    expect(mocks.focusSet).toHaveBeenCalledWith('channel:one', {
      reason: 'keyboard',
    });
    expect(mocks.shell.expand).not.toHaveBeenCalled();
  });

  it('opens a collapsed sidebar for the row', () => {
    mocks.shell.collapsed = true;
    mount();
    expect(mocks.focusRailRow(channel.id)).toBe(true);
    expect(mocks.shell.expand).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByTestId('rail'));
  });

  it('leaves Esc to a narrow split that shows the conversation alone', () => {
    mocks.shell.collapsed = true;
    mocks.shell.canCollapse = false;
    mount();
    expect(mocks.focusRailRow(channel.id)).toBe(false);
    expect(mocks.shell.expand).not.toHaveBeenCalled();
  });
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

  it('submits all section members through one bulk operation', async () => {
    const current = {
      ...label,
      channelIds: Array.from({ length: 16 }, (_, index) => `channel-${index}`),
    };
    const actions = mountActions(() => [current]);
    await actions.muteSection('label:section', true);

    expect(mocks.bulkPreferences).toHaveBeenCalledExactlyOnceWith({
      actorId: 'viewer',
      items: current.channelIds.map((item_id) => ({
        item_type: 'channel',
        item_id,
      })),
      muted: true,
    });
    expect(actions.sectionNotificationsDisabled('label:section')).toBe(false);
  });

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
        [],
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
