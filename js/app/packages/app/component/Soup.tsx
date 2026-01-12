import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { playSound } from '@app/util/sound';
import { useIsAuthenticated } from '@core/auth';
import type { BlockAliasContext } from '@core/block';
import { getIconConfig } from '@core/component/EntityIcon';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { ENABLE_TASKS_TABS } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { TOKENS } from '@core/hotkey/tokens';
import type { RegisterHotkeyReturn, ValidHotkey } from '@core/hotkey/types';
import type { BlockOrchestrator } from '@core/orchestrator';
import {
  DEFAULT_VIEWS,
  type DefaultView,
  type ViewId,
  type ViewLabel,
} from '@core/types/view';
import { cornerClip } from '@core/util/clipPath';
import { unwrapSignals } from '@core/util/unwrapSignals';
import { handleFileFolderDrop } from '@core/util/upload';
import { Popover } from '@kobalte/core/popover';
import { Tabs } from '@kobalte/core/tabs';
import type { EntityData, ExpandedEntityType } from '@macro-entity';
import {
  isTaskEntity,
  queryKeys,
  useQueryClient as useEntityQueryClient,
} from '@macro-entity';
import IconGear from '@macro-icons/macro-gear.svg';
import NoiseIcon from '@macro-icons/wide/noise.svg';
import PreviewIcon from '@macro-icons/wide/preview.svg';
import SignalIcon from '@macro-icons/wide/signal.svg';
import SortIcon from '@macro-icons/wide/sort.svg';
import { createEffectOnEntityTypeNotification } from '@notifications';
import { invalidateEntityNotifications } from '@queries/notification/user-notifications';
import { storageServiceClient } from '@service-storage/client';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Navigate } from '@solidjs/router';
import { useMutation, useQueryClient } from '@tanstack/solid-query';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { registerHotkey } from 'core/hotkey/hotkeys';
import {
  batch,
  type Component,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  type ParentComponent,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SuspenseContextComp } from './SuspenseContext';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from './split-layout/components/SplitHeader';
import { SplitToolbarRight } from './split-layout/components/SplitToolbar';
import type { SplitPanelContextType } from './split-layout/context';
import { SplitPanelContext } from './split-layout/context';
import { useSplitLayout } from './split-layout/layout';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';
import { UnifiedListView } from './UnifiedListView';
import type { SystemSortOption } from './ViewConfig';
import {
  isConfigEqual,
  VIEWCONFIG_BASE,
  VIEWCONFIG_DEFAULTS_IDS,
  type ViewConfigBase,
} from './ViewConfig';

false && fileFolderDrop;

// Entity type filter configuration
const ENTITY_TYPE_FILTERS: {
  type: ExpandedEntityType;
  label: string;
  iconType: string;
  enabled: boolean;
  shortcut: string;
}[] = [
  {
    type: 'document',
    label: 'Documents',
    iconType: 'md',
    enabled: true,
    shortcut: 'd',
  },
  {
    type: 'chat',
    label: 'Chats',
    iconType: 'chat',
    enabled: true,
    shortcut: 'a',
  },
  {
    type: 'channel',
    label: 'Messages',
    iconType: 'channel',
    enabled: true,
    shortcut: 'm',
  },
  {
    type: 'task',
    label: 'Tasks',
    iconType: 'task',
    enabled: ENABLE_TASKS_TABS,
    shortcut: 't',
  },
  {
    type: 'email',
    label: 'Mail',
    iconType: 'email',
    enabled: true,
    shortcut: 'l',
  },
  {
    type: 'project',
    label: 'Folders',
    iconType: 'project',
    enabled: true,
    shortcut: 'f',
  },
];

function EntityTypeIconFilter() {
  const renderShortcutUnderlinedInLabel = (label: string, shortcut: string) => {
    const s = shortcut.trim();
    if (!s) return label;

    const idx = label.toLowerCase().indexOf(s.toLowerCase());
    if (idx === -1) return label;

    const before = label.slice(0, idx);
    const match = label.slice(idx, idx + s.length);
    const after = label.slice(idx + s.length);

    return (
      <>
        {before}
        <span class="underline underline-offset-2 decoration-current/60">
          {match}
        </span>
        {after}
      </>
    );
  };

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

  // Get all views (excluding default views to show only custom/saved views)
  const customViews = createMemo(() => {
    const allViews = Object.entries(viewsDataStore);
    return allViews.filter(
      ([id]) => !VIEWCONFIG_DEFAULTS_IDS.includes(id as any)
    );
  });

  const [viewsDropdownOpen, setViewsDropdownOpen] = createSignal(false);
  const [viewsFocusedIndex, setViewsFocusedIndex] = createSignal(0);
  const [editingViewId, setEditingViewId] = createSignal<string | null>(null);
  const [editingViewName, setEditingViewName] = createSignal('');

  const queryClient = useQueryClient();

  const handleRenameView = async (viewId: string) => {
    const newName = editingViewName().trim();
    if (!newName) return;

    const viewData = viewsDataStore[viewId];
    if (!viewData) return;

    try {
      await storageServiceClient.views.patchView({
        saved_view_id: viewId,
        name: newName,
        config: {
          display: viewData.display,
          filters: viewData.filters,
          sort: viewData.sort,
        } as ViewConfigBase,
      });
      queryClient.invalidateQueries({ queryKey: ['savedViews'] });
    } catch (e) {
      console.error('Failed to rename view:', e);
    }

    setEditingViewId(null);
    setEditingViewName('');
  };

  const handleDeleteView = async (viewId: string) => {
    try {
      await storageServiceClient.views.deleteView({
        savedViewId: viewId,
      });
      queryClient.invalidateQueries({ queryKey: ['savedViews'] });

      // If we deleted the currently selected view, switch to default
      if (selectedView() === viewId) {
        setSelectedView('all');
      }
    } catch (e) {
      console.error('Failed to delete view:', e);
    }
  };

  const view = createMemo(() => viewsDataStore[selectedView()]);

  // Search state (must be after view is defined)
  let searchInputRef: HTMLInputElement | undefined;
  const searchText = createMemo(() => view()?.searchText ?? '');
  const setSearchText = (text: string) => {
    setViewDataStore(selectedView(), 'searchText', text);
  };

  // View config change detection and save functions
  const currentViewConfigBase = createMemo(() => {
    const v = view();
    if (!v) return null;
    return unwrapSignals<ViewConfigBase>({
      display: v.display,
      filters: v.filters,
      sort: v.sort,
    });
  });

  const stringifiedCurrentViewConfigBase = createMemo(() => {
    const config = currentViewConfigBase();
    if (!config) return null;
    return JSON.stringify(config);
  });

  const isViewConfigChanged = createMemo(() => {
    const v = view();
    if (!v) return false;

    const initialConfigStr = v.initialConfig;
    if (initialConfigStr == null || initialConfigStr === '') return false;

    try {
      const initialConfigObj = JSON.parse(initialConfigStr);
      const currentConfigObj = currentViewConfigBase();

      if (!currentConfigObj) return false;

      return !isConfigEqual(initialConfigObj, currentConfigObj);
    } catch (e) {
      console.warn(e);
      return false;
    }
  });

  const saveViewMutation = useUpsertSavedViewMutation();

  const onClickSaveViewConfigChanges = () => {
    const v = view();
    const config = currentViewConfigBase();
    if (!v || !config) return;

    saveViewMutation.mutate({
      id: v.id,
      name: v.view,
      config,
    });
    // only for default views
    if (VIEWCONFIG_DEFAULTS_IDS.includes(v.id as any)) {
      const currentConfig = stringifiedCurrentViewConfigBase();
      if (currentConfig !== null && currentConfig !== undefined) {
        setViewDataStore(selectedView(), 'initialConfig', currentConfig);
      }
    }
  };

  const onClickSaveAsNewView = () => {
    const v = view();
    const config = currentViewConfigBase();
    if (!v || !config) return;

    const baseName = v.view || 'View';
    const newName = `${baseName} Copy`;

    saveViewMutation.mutate({
      name: newName,
      config,
    });
  };

  const entityTypeFilter = createMemo(
    () => view()?.filters?.typeFilter ?? VIEWCONFIG_BASE.filters.typeFilter
  );

  const focusFilters = createMemo(
    () => view()?.filters?.focusFilters ?? VIEWCONFIG_BASE.filters.focusFilters
  );

  const toggleEntityTypeFilter = (type: ExpandedEntityType) => {
    setViewDataStore(selectedView(), 'filters', 'typeFilter', (prev) => {
      const current = prev ?? [];
      if (current.includes(type)) {
        return current.filter((t) => t !== type);
      }
      return [...current, type];
    });
    // Reset document type filter when toggling off document type
    if (type === 'document' && entityTypeFilter().includes('document')) {
      setViewDataStore(selectedView(), 'filters', 'documentTypeFilter', []);
    }
  };

  // Helper to check if we're in "inbox" mode (both signal and noise visually selected)
  const isInboxMode = () => {
    const current = focusFilters() ?? [];
    const notificationFilter = view()?.filters?.notificationFilter ?? 'all';
    return current.length === 0 && notificationFilter === 'notDone';
  };

  const toggleFocusFilter = (filter: 'signal' | 'noise') => {
    batch(() => {
      const current = focusFilters() ?? [];
      const inInbox = isInboxMode();
      const isCurrentlyActive = current.includes(filter);

      if (inInbox) {
        // In inbox mode (both selected) - clicking one deselects it, leaving the other
        const other = filter === 'signal' ? 'noise' : 'signal';
        setViewDataStore(selectedView(), 'filters', 'focusFilters', [other]);
        // Keep notDone filter
      } else if (isCurrentlyActive) {
        // Deselecting this filter
        const newFilters = current.filter((f) => f !== filter);
        if (newFilters.length === 0) {
          // No focus filters left - reset to show all
          setViewDataStore(selectedView(), 'filters', 'focusFilters', []);
          setViewDataStore(
            selectedView(),
            'filters',
            'notificationFilter',
            'all'
          );
        } else {
          // Still have one filter active
          setViewDataStore(
            selectedView(),
            'filters',
            'focusFilters',
            newFilters
          );
          // Keep notDone filter since we still have a focus filter
        }
      } else {
        // Selecting this filter - add to array
        const newFilters = [...current, filter];
        if (newFilters.length === 2) {
          // Both signal and noise selected = Inbox (notDone without focus filter)
          setViewDataStore(selectedView(), 'filters', 'focusFilters', []);
          setViewDataStore(
            selectedView(),
            'filters',
            'notificationFilter',
            'notDone'
          );
        } else {
          // Only one filter - apply it with notDone
          setViewDataStore(
            selectedView(),
            'filters',
            'focusFilters',
            newFilters
          );
          setViewDataStore(
            selectedView(),
            'filters',
            'notificationFilter',
            'notDone'
          );
        }
      }
    });
  };

  const isFilterActive = (type: ExpandedEntityType) => {
    const filter = entityTypeFilter();
    // If no filters are active, all types are shown (nothing is "active")
    if (filter.length === 0) return false;
    return filter.includes(type);
  };

  const isFocusFilterActive = (filter: 'signal' | 'noise') => {
    // If in inbox mode (both selected), show both as active
    if (isInboxMode()) return true;
    return focusFilters()?.includes(filter) === true;
  };

  const isUnreadFilterActive = () => {
    return view()?.filters?.unreadOnly === true;
  };

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
    });
  };

  // Sort functionality
  const SORT_OPTIONS: { value: SystemSortOption; label: string }[] = [
    { value: 'viewed_at', label: 'Viewed' },
    { value: 'updated_at', label: 'Updated' },
    { value: 'created_at', label: 'Created' },
  ];

  const sortType = createMemo(() => {
    const sort = view()?.sort;
    if (sort?.type === 'systemSortOption') {
      return sort.sortBy;
    }
    return 'updated_at';
  });

  const setSortType = (sortBy: SystemSortOption) => {
    batch(() => {
      (setViewDataStore as any)(
        selectedView(),
        'sort',
        'type',
        'systemSortOption'
      );
      (setViewDataStore as any)(selectedView(), 'sort', 'sortBy', sortBy);
    });
  };

  const [sortDropdownOpen, setSortDropdownOpen] = createSignal(false);
  const [sortFocusedIndex, setSortFocusedIndex] = createSignal(0);

  // Register all hotkeys
  const hotkeyConfigs: {
    hotkey: ValidHotkey;
    description: string;
    handler: () => void;
  }[] = [
    {
      hotkey: '1',
      description: 'Filter by Signal',
      handler: () => toggleFocusFilter('signal'),
    },
    {
      hotkey: '2',
      description: 'Filter by Noise',
      handler: () => toggleFocusFilter('noise'),
    },
    ...ENTITY_TYPE_FILTERS.filter((f) => f.enabled).map((f) => ({
      hotkey: f.shortcut as ValidHotkey,
      description: `Filter by ${f.label}`,
      handler: () => toggleEntityTypeFilter(f.type),
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
      hotkey: '0',
      description: 'Open views menu',
      handler: () => setViewsDropdownOpen((prev) => !prev),
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
        class="flex items-center h-full gap-0.5 px-1 overflow-x-auto scrollbar-hidden overscroll-none"
        ref={setScrollRef}
      >
        {/* Signal/Noise buttons */}
        <div class="flex items-center mr-1 shrink-0">
          <div class="flex items-center rounded-full border border-edge-muted overflow-hidden">
          <Tooltip
            tooltip={
              <LabelAndHotKey label="Signal - Important items" shortcut="1" />
            }
          >
            <button
              type="button"
              class="flex items-center gap-1.5 h-7 px-2.5 border border-transparent active:border-accent active:bg-accent active:text-panel rounded-l-full"
              classList={{
                'bg-accent text-panel border-accent':
                  isFocusFilterActive('signal'),
                'text-ink-muted hover:text-accent hover:bg-accent/20':
                  !isFocusFilterActive('signal'),
              }}
              onClick={() => toggleFocusFilter('signal')}
            >
              <SignalIcon class="size-3.5" />
              <span class="text-xs leading-none">
                Signal{' '}
                <span class="underline underline-offset-2 decoration-current/60 font-mono text-[10px] opacity-70">
                  1
                </span>
              </span>
            </button>
          </Tooltip>
          <Tooltip
            tooltip={
              <LabelAndHotKey
                label="Noise - Less important items"
                shortcut="2"
              />
            }
          >
            <button
              type="button"
              class="flex items-center gap-1.5 h-7 px-2.5 border border-transparent active:border-accent active:bg-accent active:text-panel rounded-r-full"
              classList={{
                'bg-accent text-panel border-accent':
                  isFocusFilterActive('noise'),
                'text-ink-muted hover:text-accent hover:bg-accent/20':
                  !isFocusFilterActive('noise'),
              }}
              onClick={() => toggleFocusFilter('noise')}
            >
              <NoiseIcon class="size-3.5" />
              <span class="text-xs leading-none">
                Noise{' '}
                <span class="underline underline-offset-2 decoration-current/60 font-mono text-[10px] opacity-70">
                  2
                </span>
              </span>
            </button>
          </Tooltip>
          </div>
        </div>
        {/* Separator */}
        <div class="h-4 w-px bg-edge-muted mx-1 shrink-0" />
        {/* Entity type icons */}
        <For each={ENTITY_TYPE_FILTERS.filter((f) => f.enabled)}>
          {(filter) => {
            const iconConfig = () => getIconConfig(filter.iconType);
            const isActive = () => isFilterActive(filter.type);

            return (
              <Tooltip
                tooltip={
                  <LabelAndHotKey
                    label={filter.label}
                    shortcut={filter.shortcut}
                  />
                }
              >
                <button
                  type="button"
                  class="flex items-center gap-1.5 h-7 px-2.5 border border-transparent active:border-accent active:bg-accent active:text-panel rounded-full"
                  classList={{
                    'bg-accent text-panel border-accent': isActive(),
                    'text-ink-muted hover:text-accent hover:bg-accent/20':
                      !isActive(),
                  }}
                  onClick={() => toggleEntityTypeFilter(filter.type)}
                >
                  <Dynamic component={iconConfig().icon} class="size-3.5" />
                  <span class="text-xs leading-none">
                    {renderShortcutUnderlinedInLabel(
                      filter.label,
                      filter.shortcut
                    )}
                  </span>
                </button>
              </Tooltip>
            );
          }}
        </For>
        {/* Separator before unread/preview */}
        <div class="h-4 w-px bg-edge-muted mx-1 shrink-0" />
        {/* Unread filter */}
        <Tooltip tooltip={<LabelAndHotKey label="Unread Only" shortcut="u" />}>
          <button
            type="button"
            class="relative flex items-center justify-center size-7 border border-transparent active:border-accent active:bg-accent active:text-panel"
            classList={{
              'bg-accent text-panel border-accent': isUnreadFilterActive(),
              'text-ink-muted hover:text-accent hover:bg-accent/20':
                !isUnreadFilterActive(),
            }}
            style={{ 'clip-path': cornerClip('3px') }}
            onClick={() => toggleUnreadFilter()}
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="12" cy="12" r="4" />
            </svg>
            <span class="absolute bottom-0 right-0.5 text-[9px] font-mono font-bold leading-none opacity-60">
              u
            </span>
          </button>
        </Tooltip>
        {/* Preview toggle */}
        <Tooltip
          tooltip={<LabelAndHotKey label="Toggle Preview" shortcut="p" />}
        >
          <button
            type="button"
            class="relative flex items-center justify-center size-7 border border-transparent active:border-accent active:bg-accent active:text-panel"
            classList={{
              'bg-accent text-panel border-accent': preview(),
              'text-ink-muted hover:text-accent hover:bg-accent/20': !preview(),
            }}
            style={{ 'clip-path': cornerClip('3px') }}
            onClick={() => {
              playSound('open');
              setPreview((prev) => !prev);
            }}
          >
            <PreviewIcon class="size-5.5" />
            <span class="absolute bottom-0 right-0.5 text-[9px] font-mono font-bold leading-none opacity-60">
              p
            </span>
          </button>
        </Tooltip>
        {/* Sort dropdown */}
        <Popover
          open={sortDropdownOpen()}
          onOpenChange={(open) => {
            setSortDropdownOpen(open);
            if (open) setSortFocusedIndex(0);
          }}
          placement="bottom-start"
          gutter={4}
        >
          <Popover.Trigger
            as="button"
            type="button"
            class="relative flex items-center justify-center size-7 shrink-0 text-ink-muted hover:text-accent hover:bg-accent/20 active:border-accent active:bg-accent active:text-panel border border-transparent"
            style={{ 'clip-path': cornerClip('3px') }}
          >
            <SortIcon />
            <span class="absolute bottom-0 right-0.5 text-[9px] font-mono font-bold leading-none opacity-60">
              s
            </span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              class="z-50 bg-panel border border-edge-muted shadow-lg"
              tabIndex={0}
              ref={(el) => setTimeout(() => el?.focus(), 0)}
              onKeyDown={(e: KeyboardEvent) => {
                const totalItems = SORT_OPTIONS.length;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSortFocusedIndex((prev) => (prev + 1) % totalItems);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSortFocusedIndex(
                    (prev) => (prev - 1 + totalItems) % totalItems
                  );
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  setSortType(SORT_OPTIONS[sortFocusedIndex()].value);
                  setSortDropdownOpen(false);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setSortDropdownOpen(false);
                }
              }}
            >
              <div class="flex flex-col gap-1 p-2 min-w-[140px]">
                <For each={SORT_OPTIONS}>
                  {(option, index) => (
                    <button
                      type="button"
                      class="flex items-center justify-between px-2 py-1.5 text-sm hover:bg-hover"
                      classList={{
                        'bg-hover text-ink': sortType() === option.value,
                        'text-ink': sortType() !== option.value,
                        'bg-hover': sortFocusedIndex() === index(),
                      }}
                      onClick={() => {
                        setSortType(option.value);
                        setSortDropdownOpen(false);
                      }}
                      onMouseEnter={() => setSortFocusedIndex(index())}
                    >
                      <span>{option.label}</span>
                      <Show when={sortType() === option.value}>
                        <span class="text-ink">✓</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
        {/* Views dropdown - show if there are custom views or unsaved changes */}
        <Show when={customViews().length > 0 || isViewConfigChanged()}>
          {/* Separator before views */}
          <div class="h-4 w-px bg-edge-muted mx-1 shrink-0" />
          {/* Views dropdown */}
          <Popover
            open={viewsDropdownOpen()}
            onOpenChange={(open) => {
              setViewsDropdownOpen(open);
              if (!open) {
                setEditingViewId(null);
                setEditingViewName('');
              } else {
                // Reset focus to first item when opening
                setViewsFocusedIndex(0);
              }
            }}
            placement="bottom-start"
            gutter={4}
          >
            <Popover.Trigger
              as={(props: any) => (
                <Tooltip
                  tooltip={<LabelAndHotKey label="Saved Views" shortcut="0" />}
                >
                  <button
                    type="button"
                    class="relative flex items-center justify-center size-7 text-ink-muted hover:text-accent hover:bg-accent/20 border border-transparent active:border-accent active:bg-accent active:text-panel"
                    style={{ 'clip-path': cornerClip('3px') }}
                    {...props}
                  >
                    <svg
                      width="100%"
                      height="100%"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      stroke="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M4 5H20V7H4V5ZM4 11H20V13H4V11ZM4 17H20V19H4V17Z" />
                    </svg>
                    <span class="absolute bottom-0 right-0.5 text-[9px] font-mono font-bold leading-none opacity-60">
                      0
                    </span>
                  </button>
                </Tooltip>
              )}
            />
            <Popover.Portal>
              <Popover.Content
                class="z-50 bg-panel border border-edge-muted shadow-lg"
                onKeyDown={(e: KeyboardEvent) => {
                  const views = customViews();
                  // Count total items: views + save options if changed
                  const hasChangeOptions = isViewConfigChanged();
                  const totalItems = views.length + (hasChangeOptions ? 2 : 0);

                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setViewsFocusedIndex((prev) => (prev + 1) % totalItems);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setViewsFocusedIndex(
                      (prev) => (prev - 1 + totalItems) % totalItems
                    );
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const idx = viewsFocusedIndex();
                    if (idx < views.length) {
                      // Select view
                      const [viewId] = views[idx];
                      setSelectedView(viewId);
                      setViewsDropdownOpen(false);
                    } else if (hasChangeOptions) {
                      // Save options
                      if (idx === views.length) {
                        onClickSaveViewConfigChanges();
                      } else {
                        onClickSaveAsNewView();
                      }
                      setViewsDropdownOpen(false);
                    }
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setViewsDropdownOpen(false);
                  }
                }}
                tabIndex={0}
                ref={(el) => setTimeout(() => el?.focus(), 0)}
              >
                <div class="flex flex-col gap-1 p-2 min-w-[200px]">
                  <For each={customViews()}>
                    {([viewId, viewData], index) => (
                      <div class="flex items-center gap-1 group">
                        <Show
                          when={editingViewId() === viewId}
                          fallback={
                            <button
                              type="button"
                              class="flex-1 flex items-center justify-between px-2 py-1.5 text-sm hover:bg-hover"
                              classList={{
                                'bg-hover text-ink': selectedView() === viewId,
                                'text-ink': selectedView() !== viewId,
                                'bg-hover': viewsFocusedIndex() === index(),
                              }}
                              onClick={() => {
                                setSelectedView(viewId);
                                setViewsDropdownOpen(false);
                              }}
                              onMouseEnter={() => setViewsFocusedIndex(index())}
                            >
                              <span class="truncate max-w-[100px]">
                                {viewData.view || viewId}
                              </span>
                              <Show when={selectedView() === viewId}>
                                <span class="text-accent ml-2">✓</span>
                              </Show>
                            </button>
                          }
                        >
                          <input
                            type="text"
                            value={editingViewName()}
                            onInput={(e) =>
                              setEditingViewName(e.currentTarget.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleRenameView(viewId);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingViewId(null);
                                setEditingViewName('');
                              }
                            }}
                            class="flex-1 px-2 py-1 text-sm bg-surface border border-edge rounded focus:outline-none focus:border-accent"
                            ref={(el) => setTimeout(() => el.focus(), 0)}
                          />
                          <button
                            type="button"
                            class="p-1 text-accent hover:bg-accent/20 rounded"
                            onClick={() => handleRenameView(viewId)}
                          >
                            ✓
                          </button>
                        </Show>
                        <Show when={editingViewId() !== viewId}>
                          <button
                            type="button"
                            class="p-1 text-ink-muted hover:text-ink hover:bg-hover opacity-0 group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingViewId(viewId);
                              setEditingViewName(viewData.view || viewId);
                            }}
                            title="Rename"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            class="p-1 text-ink-muted hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteView(viewId);
                            }}
                            title="Delete"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                            </svg>
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                  {/* Save options when view config has changed */}
                  <Show when={isViewConfigChanged()}>
                    <div class="border-t border-edge-muted my-1" />
                    <button
                      type="button"
                      class="flex items-center px-2 py-1.5 text-sm hover:bg-hover text-ink"
                      classList={{
                        'bg-hover':
                          viewsFocusedIndex() === customViews().length,
                      }}
                      onClick={() => {
                        onClickSaveViewConfigChanges();
                        setViewsDropdownOpen(false);
                      }}
                      onMouseEnter={() =>
                        setViewsFocusedIndex(customViews().length)
                      }
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      class="flex items-center px-2 py-1.5 text-sm hover:bg-hover text-ink"
                      classList={{
                        'bg-hover':
                          viewsFocusedIndex() === customViews().length + 1,
                      }}
                      onClick={() => {
                        onClickSaveAsNewView();
                        setViewsDropdownOpen(false);
                      }}
                      onMouseEnter={() =>
                        setViewsFocusedIndex(customViews().length + 1)
                      }
                    >
                      Save as New View
                    </button>
                  </Show>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        </Show>
        {/* Separator before search */}
        <div class="h-4 w-px bg-edge-muted mx-1 shrink-0" />
        {/* Compact search bar */}
        <div class="flex items-center gap-1 shrink-0">
          <Tooltip tooltip={<LabelAndHotKey label="Search" shortcut="⌘F" />}>
            <div class="relative flex items-center">
              <input
                ref={(el) => {
                  searchInputRef = el;
                }}
                type="text"
                placeholder="⌘F"
                value={searchText()}
                onInput={(e) => setSearchText(e.currentTarget.value)}
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
                class="w-24 px-1 py-1 text-xs bg-transparent border-none outline-none ring-0 focus:outline-none focus:ring-0 placeholder:text-ink-muted placeholder:select-none"
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
      setViewDataStore('all', 'searchText', '');
    });
  };

  return (
    <Tooltip tooltip={<LabelAndHotKey label="Clear filters" shortcut="/" />}>
      <button
        type="button"
        class="relative flex items-center justify-center size-7 text-ink-muted hover:text-accent hover:bg-accent/20 border border-transparent active:border-accent active:bg-accent active:text-panel"
        style={{ 'clip-path': cornerClip('3px') }}
        onClick={clearAllFilters}
      >
        ✕
        <span class="absolute bottom-0 right-0.5 text-[9px] font-mono font-bold leading-none opacity-60">
          /
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
          class="relative flex items-center justify-center size-7 border border-transparent active:border-accent active:bg-accent active:text-panel"
          classList={{
            'bg-hover text-ink': settingsOpen(),
            'text-ink-muted hover:text-accent hover:bg-accent/20':
              !settingsOpen(),
          }}
          style={{ 'clip-path': cornerClip('3px') }}
          onClick={() => toggleSettings()}
        >
          <IconGear class="size-4" />
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

  return null;
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
            <UnifiedListView />
          </SuspenseContextComp>
        </Match>
      </Switch>
    </ViewTab>
  );
};

const PreviewPanelContent: Component<{
  selectedEntity: EntityData;
  orchestrator: BlockOrchestrator;
  splitPanelContext: SplitPanelContextType;
}> = (props) => {
  const blockInstance = () => {
    const aliasContext = isTaskEntity(props.selectedEntity)
      ? ({
          alias: 'task',
          baseType: 'md',
        } as BlockAliasContext)
      : undefined;
    return props.orchestrator.createBlockInstance(
      props.selectedEntity.type === 'document'
        ? fileTypeToResolvedBlockName(props.selectedEntity.fileType)
        : props.selectedEntity.type,
      props.selectedEntity.id,
      { aliasContext }
    );
  };
  const [interactedWith, setInteractedWith] = createSignal(false);

  createRenderEffect((prevId: string) => {
    const id = props.selectedEntity.id;
    if (id !== prevId) {
      setInteractedWith(false);
    }
    return id;
  }, props.selectedEntity.id);

  return (
    <div
      class="size-full"
      onFocusIn={(event) => {
        if (interactedWith()) return;
        const relatedTarget = event.relatedTarget;
        const currentTarget = event.currentTarget;

        // TODO: use state instead to determine when preview block can recieve focus
        if (event.target.hasAttribute('data-allow-focus-in-preview')) {
          setInteractedWith(true);
          return;
        }

        if (relatedTarget instanceof HTMLElement) {
          if (!currentTarget.contains(relatedTarget)) {
            relatedTarget.focus();
          }
        }
      }}
      onPointerDown={() => {
        setInteractedWith(true);
      }}
    >
      <SplitPanelContext.Provider
        value={{
          ...props.splitPanelContext,
          layoutRefs: {
            ...props.splitPanelContext.layoutRefs,
            headerLeft: undefined,
            headerRight: undefined,
          },
          halfSplitState: () => ({
            side: 'right',
            percentage: 30,
          }),
        }}
      >
        <Dynamic component={blockInstance().element} />
      </SplitPanelContext.Provider>
    </div>
  );
};

const PreviewPanel: Component<{
  selectedEntity: EntityData | undefined;
  orchestrator: BlockOrchestrator;
  splitPanelContext: SplitPanelContextType;
}> = (props) => {
  return (
    <div class="flex flex-row size-full sm:w-[70%] max-sm:h-[50%] max-sm:border-t border-edge-muted shrink-0 sm:shadow-inner">
      <Show
        when={props.selectedEntity?.type !== 'project' && props.selectedEntity}
      >
        {(selectedEntity) => (
          <PreviewPanelContent
            selectedEntity={selectedEntity()}
            orchestrator={props.orchestrator}
            splitPanelContext={props.splitPanelContext}
          />
        )}
      </Show>
    </div>
  );
};

export function Soup() {
  const authenticated = useIsAuthenticated();
  if (!authenticated()) return <Navigate href="/" />;

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
      hotkey: ['p'],
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

  const droppableId = 'soup-drop-zone';
  const droppable = createDroppable(droppableId);

  const dragDropContext = useDragDropContext();
  if (dragDropContext) {
    dragDropContext[1].onDragEnd((event) => {
      if (!event.droppable || event.droppable.id !== droppableId) return;

      // TODO: moveToFolder action
    });
  }

  const handleFileUpload = useHandleFileUpload();

  const notificationSource = useGlobalNotificationSource();
  createEffectOnEntityTypeNotification(
    notificationSource,
    'channel',
    (notification) => {
      entityQueryClient.invalidateQueries({
        queryKey: queryKeys.all.channel,
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
    <div
      class="relative flex flex-col bg-panel size-full"
      use:droppable
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
      <Show when={isDragging() || droppable.isActiveDroppable}>
        <FileDropOverlay valid={isValidDrag()}>
          <Show when={!isValidDrag()}>
            <div class="font-mono text-failure">[!] Invalid file type</div>
          </Show>
          <div class="font-mono">
            Drop any file here to add it to your workspace
          </div>
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
    </div>
  );
}

function AllView() {
  return <UnifiedListView />;
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
      <UnifiedListView />
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
