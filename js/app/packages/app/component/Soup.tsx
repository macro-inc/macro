import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { playSound } from '@app/util/sound';
import { useIsAuthenticated } from '@core/context/user';
import { getIconConfig } from '@core/component/EntityIcon';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { ENABLE_UNIFIED_LIST_AI_INPUT } from '@core/constant/featureFlags';
import { IS_MAC } from '@core/constant/isMac';
import { useSettingsState } from '@core/constant/SettingsState';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { TOKENS } from '@core/hotkey/tokens';
import type { RegisterHotkeyReturn, ValidHotkey } from '@core/hotkey/types';
import {
  DEFAULT_VIEWS,
  type DefaultView,
  type ViewId,
  type ViewLabel,
} from '@core/types/view';
import { handleFileFolderDrop } from '@core/util/upload';
import { Tabs } from '@kobalte/core/tabs';
import {
  queryKeys,
  useQueryClient as useEntityQueryClient,
} from '@macro-entity';
import IconGear from '@macro-icons/macro-gear.svg';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import PreviewIcon from '@macro-icons/wide/preview.svg';
import NoiseIcon from '@macro-icons/wide/noise.svg';
import SignalIcon from '@macro-icons/wide/signal.svg';
import XIcon from '@icon/regular/x.svg?component-solid';
import { createEffectOnEntityTypeNotification } from '@notifications';
import { invalidateEntityNotifications } from '@queries/notification/user-notifications';
import { storageServiceClient } from '@service-storage/client';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Navigate } from '@solidjs/router';
import { useMutation, useQueryClient } from '@tanstack/solid-query';
import { registerHotkey } from 'core/hotkey/hotkeys';
import {
  batch,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  type ParentComponent,
  Show,
  Switch,
} from 'solid-js';
import { PreviewPanel } from './PreviewPanel';
import { SoupChatInput } from './SoupChatInput';
import { SuspenseContextComp } from './SuspenseContext';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from './split-layout/components/SplitHeader';
import { SplitToolbarRight } from './split-layout/components/SplitToolbar';
import { SplitPanelContext } from './split-layout/context';
import { useSplitLayout } from './split-layout/layout';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';
import { UnifiedListView } from './UnifiedListView';
import type { SystemSortOption } from './ViewConfig';
import {
  VIEWCONFIG_BASE,
  VIEWCONFIG_DEFAULTS_IDS,
  type ViewConfigBase,
} from './ViewConfig';
import { ENTITY_TYPE_FILTERS } from './Soup/utils/filterConfigs';
import { useFilterActions } from './Soup/hooks/useFilterActions';
import {
  FilterButton,
  FilterDivider,
  ShortcutLabel,
} from './Soup/components/FilterButton';
import { SortDropdown } from './Soup/components/SortDropdown';

false && fileFolderDrop;

function EntityTypeIconFilter() {
  const splitContext = useSplitPanelOrThrow();
  const {
    splitHotkeyScope,
    previewState,
    soupContext: {
      viewsDataStore,
      setViewDataStore,
      selectedView,
      setSelectedView,
    },
  } = splitContext;
  const [preview, setPreview] = previewState;

  const view = createMemo(() => viewsDataStore[selectedView()]);

  // Search state (must be after view is defined)
  let searchInputRef: HTMLInputElement | undefined;
  const [searchFocused, setSearchFocused] = createSignal(false);
  const searchText = createMemo(() => view()?.searchText ?? '');
  const setSearchText = (text: string) => {
    setViewDataStore(selectedView(), 'searchText', text);
  };

  // Memoized filter accessors
  const entityTypeFilter = createMemo(
    () => view()?.filters?.typeFilter ?? VIEWCONFIG_BASE.filters.typeFilter
  );
  const channelCategoryFilter = createMemo(
    () =>
      view()?.filters?.channelCategoryFilter ??
      VIEWCONFIG_BASE.filters.channelCategoryFilter
  );
  const focusFilters = createMemo(
    () => view()?.filters?.focusFilters ?? VIEWCONFIG_BASE.filters.focusFilters
  );
  const notificationFilter = createMemo(
    () =>
      view()?.filters?.notificationFilter ??
      VIEWCONFIG_BASE.filters.notificationFilter
  );
  const unrollNotifications = createMemo(
    () =>
      view()?.display?.unrollNotifications ??
      VIEWCONFIG_BASE.display.unrollNotifications
  );
  const documentTypeFilter = createMemo(
    () =>
      view()?.filters?.documentTypeFilter ??
      VIEWCONFIG_BASE.filters.documentTypeFilter
  );

  // Use the extracted filter actions hook
  const filterActions = useFilterActions({
    selectedView,
    setViewDataStore,
    entityTypeFilter,
    documentTypeFilter,
    channelCategoryFilter,
    focusFilters,
  });

  // Ensure state consistency when switching views (not continuous watching)
  createEffect(
    on(selectedView, (viewId) => {
      const focus = focusFilters() ?? [];
      if (!focus.includes('signal') && !focus.includes('noise')) return;

      batch(() => {
        if (notificationFilter() !== 'notDone') {
          setViewDataStore(viewId, 'filters', 'notificationFilter', 'notDone');
        }
        if (!unrollNotifications()) {
          setViewDataStore(viewId, 'display', 'unrollNotifications', true);
        }
      });
    })
  );

  const isUnreadFilterActive = () => view()?.filters?.unreadOnly === true;

  const toggleUnreadFilter = () => {
    const current = view()?.filters?.unreadOnly ?? false;
    setViewDataStore(selectedView(), 'filters', 'unreadOnly', !current);
  };

  const clearAllFilters = () => {
    batch(() => {
      setSelectedView('all');
      setViewDataStore('all', 'filters', 'typeFilter', []);
      setViewDataStore('all', 'filters', 'documentTypeFilter', []);
      setViewDataStore('all', 'filters', 'focusFilters', []);
      setViewDataStore('all', 'filters', 'notificationFilter', 'all');
      setViewDataStore('all', 'filters', 'unreadOnly', false);
      setViewDataStore('all', 'filters', 'channelCategoryFilter', []);
    });
  };

  const sortType = createMemo(() => {
    const sort = view()?.sort;
    if (sort?.type === 'systemSortOption') {
      return sort.sortBy;
    }
    return 'updated_at';
  });

  const setSortType = (sortBy: SystemSortOption) => {
    const currentSort = view()?.sort;
    setViewDataStore(selectedView(), 'sort', {
      type: 'systemSortOption',
      sortBy,
      sortOrder: currentSort?.sortOrder ?? 'ascending',
    });
  };

  const [sortDropdownOpen, setSortDropdownOpen] = createSignal(false);

  // Register all hotkeys
  const hotkeyConfigs: {
    hotkey: ValidHotkey;
    description: string;
    handler: () => void;
  }[] = [
    {
      hotkey: 'i',
      description: 'Toggle Inbox',
      handler: () => filterActions.toggleFocusFilter('signal'),
    },
    {
      hotkey: 'o',
      description: 'Toggle Other',
      handler: () => filterActions.toggleFocusFilter('noise'),
    },
    ...ENTITY_TYPE_FILTERS.filter((f) => f.enabled).map((f) => ({
      hotkey: f.shortcut as ValidHotkey,
      description: `Filter by ${f.label}`,
      handler: filterActions.getFilterHandler(f),
    })),
    {
      hotkey: 'u',
      description: 'Filter by Unread',
      handler: () => toggleUnreadFilter(),
    },
    {
      hotkey: 's',
      description: 'Open sort menu',
      handler: () => setSortDropdownOpen((prev) => !prev),
    },
    {
      hotkey: '/',
      description: 'Clear filters',
      handler: () => {
        clearAllFilters();
        setViewDataStore('all', 'searchText', '');
      },
    },
    {
      hotkey: 'cmd+f',
      description: 'Search',
      handler: () => {
        searchInputRef?.focus();
        if (searchInputRef?.value) searchInputRef.select();
      },
    },
  ];

  const hotkeyDisposers = hotkeyConfigs.map((config) =>
    registerHotkey({
      hotkey: [config.hotkey],
      scopeId: splitHotkeyScope,
      description: config.description,
      keyDownHandler: () => {
        config.handler();
        return true;
      },
      registrationType: 'add',
    })
  );

  onCleanup(() => {
    hotkeyDisposers.forEach((d) => d.dispose());
  });

  // Scroll shadow indicators
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement | null>(null);
  const [leftOpacity, setLeftOpacity] = createSignal(0);
  const [rightOpacity, setRightOpacity] = createSignal(0);
  const SCROLL_THRESHOLD = 10;

  // Track size changes to update indicators
  const size = createElementSize(scrollRef);
  const containerWidth = () => size.width ?? 0;

  const updateClipIndicators = () => {
    const ref = scrollRef();
    if (!ref) return;
    const { scrollLeft, scrollWidth, clientWidth } = ref;

    const leftAmount = Math.min(scrollLeft, SCROLL_THRESHOLD);
    setLeftOpacity(leftAmount / SCROLL_THRESHOLD);

    const maxScroll = scrollWidth - clientWidth;
    const remainingScroll = maxScroll - scrollLeft;
    const rightAmount = Math.min(remainingScroll, SCROLL_THRESHOLD);
    setRightOpacity(rightAmount / SCROLL_THRESHOLD);
  };

  // Update indicators when size changes
  createEffect(() => {
    containerWidth(); // Track size changes
    updateClipIndicators();
  });

  onMount(() => {
    const ref = scrollRef();
    if (!ref) return;
    ref.addEventListener('scroll', updateClipIndicators);
    onCleanup(() => ref?.removeEventListener('scroll', updateClipIndicators));
  });

  return (
    <div class="relative h-full">
      {/* Left clip boundary indicator */}
      <div
        class="absolute pointer-events-none left-0 top-px bottom-px w-3 z-2 pattern-diagonal-4 pattern-edge mask-r-from-0% border-l border-edge-muted"
        style={{ opacity: leftOpacity() }}
      />
      {/* Right clip boundary indicator */}
      <div
        class="absolute pointer-events-none right-0 top-px bottom-px w-3 z-2 pattern-diagonal-4 pattern-edge mask-l-from-0% border-r border-edge-muted"
        style={{ opacity: rightOpacity() }}
      />
      <div
        class="flex items-center h-full overflow-x-auto scrollbar-hidden overscroll-none text-xs touch:mobile-width:text-sm"
        ref={setScrollRef}
      >
        {/* Inbox toggle */}
        <FilterButton
          icon={SignalIcon}
          label="Inbox"
          shortcut="i"
          isActive={filterActions.isInboxActive}
          onClick={() => filterActions.toggleFocusFilter('signal')}
        />
        {/* Other toggle */}
        <FilterButton
          icon={NoiseIcon}
          label="Other"
          shortcut="o"
          isActive={filterActions.isOtherActive}
          onClick={() => filterActions.toggleFocusFilter('noise')}
        />
        <FilterDivider />
        {/* Unread filter */}
        <div class="flex items-center mr-0.5 shrink-0">
          <Tooltip
            tooltip={<LabelAndHotKey label="Unread Only" shortcut="u" />}
          >
            <button
              type="button"
              class="flex items-center gap-1 h-[22px] touch:mobile-width:h-9 pr-2.5 pl-1 active:bg-accent active:text-panel rounded-full"
              classList={{
                'bg-accent text-panel': isUnreadFilterActive(),
                'text-ink-muted hover:text-accent hover:bg-accent/20':
                  !isUnreadFilterActive(),
              }}
              onClick={() => toggleUnreadFilter()}
            >
              <svg
                class="size-4"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="12" cy="12" r="4" />
              </svg>
              <span class="leading-none">
                <ShortcutLabel label="Unread" shortcut="u" />
              </span>
            </button>
          </Tooltip>
        </div>
        <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
        {/* Entity type icons */}
        <div class="flex items-center shrink-0">
          <For each={ENTITY_TYPE_FILTERS.filter((f) => f.enabled)}>
            {(filter) => {
              const iconConfig = () => getIconConfig(filter.iconType);
              return (
                <FilterButton
                  icon={iconConfig().icon}
                  label={filter.label}
                  shortcut={filter.shortcut}
                  isActive={() => filterActions.isFilterConfigActive(filter)}
                  onClick={filterActions.getFilterHandler(filter)}
                  paddingClass="px-2.5"
                />
              );
            }}
          </For>
        </div>
        <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
        {/* Preview toggle */}
        <Tooltip
          tooltip={<LabelAndHotKey label="Toggle Preview" shortcut="space" />}
        >
          <button
            type="button"
            class="flex items-center gap-1.5 h-[22px] touch:mobile-width:h-9 px-2.5 active:bg-accent active:text-panel rounded-full"
            classList={{
              'bg-accent text-panel': preview(),
              'text-ink-muted hover:text-accent hover:bg-accent/20': !preview(),
            }}
            onClick={() => {
              playSound('open');
              setPreview((prev) => !prev);
            }}
          >
            <PreviewIcon class="size-4.5" />
            <span class="leading-none">
              <ShortcutLabel label="Preview" shortcut="space" />
            </span>
          </button>
        </Tooltip>
        <FilterDivider />
        {/* Sort dropdown */}
        <SortDropdown
          value={sortType}
          onChange={setSortType}
          open={sortDropdownOpen}
          onOpenChange={setSortDropdownOpen}
        />
        <div class="touch:mobile-width:-order-1">
          <FilterDivider />
        </div>
        {/* Filter search bar */}
        <div class="flex items-center shrink-0 touch:mobile-width:-order-2">
          <Tooltip tooltip={<LabelAndHotKey label="Filter" shortcut="⌘F" />}>
            <div
              class="relative flex items-center gap-1.5 h-[22px] touch:mobile-width:h-9 px-2.5 rounded-full touch:mobile-width:min-w-35"
              classList={{
                'bg-accent text-panel': !!searchText() && !searchFocused(),
                'text-ink-muted hover:text-accent hover:bg-accent/20':
                  !searchText() || searchFocused(),
              }}
              onClick={() => searchInputRef?.focus()}
            >
              <SearchIcon class="size-4.5 shrink-0" />
              <Show when={!searchText() && !searchFocused()}>
                <span class="leading-none pointer-events-none">
                  <span class="underline underline-offset-2 decoration-current/60">
                    {IS_MAC ? '⌘' : '^'}F
                  </span>
                  <span>ilter</span>
                </span>
              </Show>
              <input
                ref={(el) => {
                  searchInputRef = el;
                }}
                type="text"
                value={searchText()}
                onInput={(e) => setSearchText(e.currentTarget.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Escape' ||
                    e.key === 'Enter' ||
                    e.key === 'ArrowDown'
                  ) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                class="p-0 bg-transparent border-none outline-none ring-0 focus:outline-none focus:ring-0 cursor-default"
                style={{
                  width:
                    !searchText() && !searchFocused()
                      ? '0'
                      : `${Math.max(5, searchText().length + 1)}ch`,
                }}
              />
            </div>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function ClearFiltersButton() {
  const splitContext = useSplitPanelOrThrow();
  const {
    soupContext: { setViewDataStore, setSelectedView },
  } = splitContext;

  const clearAllFilters = () => {
    batch(() => {
      setSelectedView('all');
      setViewDataStore('all', 'filters', 'typeFilter', []);
      setViewDataStore('all', 'filters', 'documentTypeFilter', []);
      setViewDataStore('all', 'filters', 'focusFilters', []);
      setViewDataStore('all', 'filters', 'notificationFilter', 'all');
      setViewDataStore('all', 'filters', 'unreadOnly', false);
      setViewDataStore('all', 'filters', 'channelCategoryFilter', []);
      setViewDataStore('all', 'searchText', '');
    });
  };

  return (
    <Tooltip tooltip={<LabelAndHotKey label="Clear filters" shortcut="/" />}>
      <button
        type="button"
        class="flex items-center gap-1.5 px-2.5 rounded-full text-ink-muted hover:text-accent hover:bg-accent/20 active:bg-accent active:text-panel"
        onClick={clearAllFilters}
      >
        <XIcon class="size-4.5" />
        <span class="text-xs touch:mobile-width:text-sm leading-none">
          Clear
          <span class="ml-1 font-mono opacity-70">/</span>
        </span>
      </button>
    </Tooltip>
  );
}

function SettingsButton() {
  const { settingsOpen, toggleSettings } = useSettingsState();
  const { getSplitCount } = useSplitLayout();

  // Hide settings button when there are multiple splits
  const isSingleSplit = () => getSplitCount() <= 1;

  return (
    <Show when={isSingleSplit()}>
      <Tooltip
        tooltip={
          <LabelAndHotKey
            label={settingsOpen() ? 'Close Settings' : 'Open Settings'}
            hotkeyToken={TOKENS.global.toggleSettings}
          />
        }
      >
        <button
          type="button"
          class="relative flex items-center justify-center size-[22px] rounded-full active:bg-accent active:text-panel"
          classList={{
            'bg-hover text-ink': settingsOpen(),
            'text-ink-muted hover:text-accent hover:bg-accent/20':
              !settingsOpen(),
          }}
          onClick={() => toggleSettings()}
        >
          <IconGear class="size-4.5" />
        </button>
      </Tooltip>
    </Show>
  );
}

const ViewTab: ParentComponent<{
  viewId: ViewId;
}> = (props) => {
  return (
    <Tabs.Content class="flex flex-col size-full" value={props.viewId}>
      {/* If Kobalte TabContent recieves Suspense as direct child, Suspense owner doesn't cleanup and causes memory leak */}
      {/* Make sure Suspense isn't root child by by wrapping children with DOM node */}
      <div class="contents">{props.children}</div>
    </Tabs.Content>
  );
};

let runSuspenseWarningLog = false;
const SuspenseUnifiedListFallback = () => {
  const runWarningLog = () => {
    if (!runSuspenseWarningLog) {
      setTimeout(() => {
        runSuspenseWarningLog = true;
      });
      return;
    }

    console.warn('UnifiedList Suspsense Triggered');
  };

  runWarningLog();

  // Return a skeleton that maintains layout instead of null to avoid black flash
  return (
    <div class="size-full flex flex-col gap-1 p-2 animate-pulse">
      <div class="h-12 bg-surface-2 rounded" />
      <div class="h-12 bg-surface-2 rounded" />
      <div class="h-12 bg-surface-2 rounded" />
      <div class="h-12 bg-surface-2 rounded" />
      <div class="h-12 bg-surface-2 rounded" />
    </div>
  );
};

const ViewWithSearch: Component<{
  viewId: ViewId;
}> = (props) => {
  return (
    <ViewTab viewId={props.viewId}>
      <Switch>
        <Match
          when={props.viewId === 'email' && DEFAULT_VIEWS.includes('email')}
        >
          <SuspenseContextComp fallback={<SuspenseUnifiedListFallback />}>
            <EmailView />
          </SuspenseContextComp>
        </Match>
        <Match when={props.viewId === 'all' && DEFAULT_VIEWS.includes('all')}>
          <SuspenseContextComp fallback={<SuspenseUnifiedListFallback />}>
            <AllView />
          </SuspenseContextComp>
        </Match>
        <Match when={true}>
          <SuspenseContextComp fallback={<SuspenseUnifiedListFallback />}>
            <UnifiedListView hideToolbar />
          </SuspenseContextComp>
        </Match>
      </Switch>
    </ViewTab>
  );
};

export function Soup() {
  const isAuthenticated = useIsAuthenticated();

  const splitPanelContext = useSplitPanelOrThrow();
  const {
    handle,
    splitHotkeyScope,
    soupContext: {
      viewsDataStore: viewsData,
      selectedView,
      setSelectedView,
      entityListRefSignal: [, setEntityListRef],
    },
  } = splitPanelContext;
  const view = createMemo(() => viewsData[selectedView()]);
  const previewState = () => splitPanelContext.previewState;
  const [preview, setPreview] = previewState();
  const selectedEntity = () => view().selectedEntity;

  // Sync selected view to split metadata
  createEffect(() => {
    handle.updateMeta?.({ viewId: selectedView() });
  });

  const orchestrator = useGlobalBlockOrchestrator();

  const entityQueryClient = useEntityQueryClient();

  const hotkeyDisposers: RegisterHotkeyReturn[] = [];

  hotkeyDisposers.push(
    registerHotkey({
      hotkey: ['space'],
      scopeId: splitHotkeyScope,
      description: 'Toggle Preview',
      hotkeyToken: TOKENS.unifiedList.togglePreview,
      keyDownHandler: () => {
        playSound('open');
        setPreview((prev) => !prev);
        return true;
      },
      // displayPriority: 10,
    })
  );

  const [isDragging, setIsDragging] = createSignal(false);
  const [isValidDrag, setIsValidDrag] = createSignal(true);

  const handleFileUpload = useHandleFileUpload();

  const notificationSource = useGlobalNotificationSource();
  createEffectOnEntityTypeNotification(
    notificationSource,
    'channel',
    (notification) => {
      entityQueryClient.invalidateQueries({
        queryKey: queryKeys.all.channel,
      });
      entityQueryClient.invalidateQueries({
        queryKey: queryKeys.all.dss,
      });
      invalidateEntityNotifications(notification.entity_id);
    }
  );

  createEffectOnEntityTypeNotification(notificationSource, 'email', () => {
    entityQueryClient.invalidateQueries({
      // HACK: this needs to be improved, since we use a single query, per entity invalidations
      // become a little more complicated.
      queryKey: queryKeys.all.entity,
    });
  });

  createEffectOnEntityTypeNotification(
    notificationSource,
    'document',
    (notification) => {
      if (notification.notificationEventType === 'task_assigned') {
        entityQueryClient.invalidateQueries({
          queryKey: queryKeys.all.dss,
        });
        invalidateEntityNotifications(notification.entity_id);
      }
    }
  );

  let tabsRef: HTMLDivElement | undefined;

  onCleanup(() => {
    setEntityListRef(undefined);
    hotkeyDisposers.forEach((disposer) => disposer.dispose());
  });

  return (
    <Show when={isAuthenticated() !== false} fallback={<Navigate href="/" />}>
      <div
        class="relative flex flex-col bg-panel size-full"
        use:fileFolderDrop={{
          onDrop: (fileEntries, folderEntries) => {
            handleFileFolderDrop(fileEntries, folderEntries, handleFileUpload);
          },
          onDragStart: () => {
            setIsValidDrag(true);
            setIsDragging(true);
          },
          onDragEnd: () => setIsDragging(false),
        }}
      >
        <Show when={isDragging()}>
          <FileDropOverlay valid={isValidDrag()}>
            <Show when={!isValidDrag()}>
              <div class="text-failure">[!] Invalid file type</div>
            </Show>
            <div>Drop any file here to add it to your workspace</div>
          </FileDropOverlay>
        </Show>

        <div class="relative flex-grow min-h-0 flex max-sm:flex-col flex-row size-full">
          <SplitPanelContext.Provider
            value={{
              ...splitPanelContext,
              halfSplitState: () =>
                preview() ? { side: 'left', percentage: 30 } : undefined,
            }}
          >
            <Tabs
              ref={tabsRef}
              class="@container/soup [container-type:inline-size] flex flex-col gap-1 size-full overflow-x-clip"
              classList={{
                'border-r border-edge-muted': preview(),
              }}
              value={selectedView()}
              onChange={setSelectedView}
            >
              <SplitHeaderLeft>
                <EntityTypeIconFilter />
              </SplitHeaderLeft>
              <SplitHeaderRight>
                <div class="flex items-center h-full gap-0.5">
                  <ClearFiltersButton />
                  <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
                  <SettingsButton />
                </div>
              </SplitHeaderRight>
              <For each={Object.keys(viewsData)}>
                {(viewId) => <ViewWithSearch viewId={viewId} />}
              </For>
            </Tabs>
          </SplitPanelContext.Provider>
          <Show when={preview()}>
            <PreviewPanel
              selectedEntity={selectedEntity()}
              orchestrator={orchestrator}
              splitPanelContext={splitPanelContext}
            />
          </Show>
        </div>
        <Show when={ENABLE_UNIFIED_LIST_AI_INPUT}>
          <SoupChatInput />
        </Show>
      </div>
    </Show>
  );
}

function AllView() {
  return <UnifiedListView hideToolbar />;
}

function EmailView() {
  const {
    emailViewSignal: [emailView, setEmailView],
    viewsDataStore,
    selectedView,
  } = useSplitPanelOrThrow().soupContext;
  const viewData = createMemo(() => viewsDataStore[selectedView()]);

  return (
    <>
      <UnifiedListView hideToolbar />
      <SplitToolbarRight>
        <div class="flex flex-row items-center pr-2">
          <SegmentedControl
            disabled={!!viewData().searchText}
            size="SM"
            label="View"
            list={['inbox', 'sent', 'drafts']}
            value={emailView()}
            onChange={setEmailView}
          />
        </div>
      </SplitToolbarRight>
    </>
  );
}

export const useUpsertSavedViewMutation = () => {
  const queryClient = useQueryClient();
  return useMutation(() => ({
    mutationFn: async (
      viewData:
        | {
            config: ViewConfigBase;
            id?: ViewId;
            name: ViewLabel;
          }
        | {
            id: ViewId;
          }
    ) => {
      const isDefaultView = VIEWCONFIG_DEFAULTS_IDS.includes(
        viewData.id as DefaultView
      );
      if ('config' in viewData) {
        // if data id is in defaults, exclude default, set up args to create new view
        if (isDefaultView) {
          // don't exclude default view on editing default view config
          // await storageServiceClient.views.excludeDefaultView({
          //   defaultViewId: viewData.id!,
          // });
          viewData.id = undefined;
          viewData.name = `My ${viewData.name}`;
        }
        // create new view
        if (!viewData.id) {
          return await storageServiceClient.views.createSavedView({
            name: viewData.name,
            config: viewData.config,
          });
        } // patch existing view
        else {
          return await storageServiceClient.views.patchView({
            saved_view_id: viewData.id,
            name: viewData.name,
            config: viewData.config,
          });
        }
      } else {
        // delete or exclude view
        if (isDefaultView) {
          // for now don't exclude default view
          // return await storageServiceClient.views.excludeDefaultView({
          //   defaultViewId: viewData.id,
          // });
        } else {
          return await storageServiceClient.views.deleteView({
            savedViewId: viewData.id,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedViews'] });
    },
  }));
};
