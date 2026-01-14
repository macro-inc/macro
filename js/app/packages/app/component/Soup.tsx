import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { playSound } from '@app/util/sound';
import { useIsAuthenticated } from '@core/auth';
import { getIconConfig } from '@core/component/EntityIcon';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { ENABLE_TASKS_TABS } from '@core/constant/featureFlags';
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
import { cornerClip } from '@core/util/clipPath';
import { handleFileFolderDrop } from '@core/util/upload';
import { Popover } from '@kobalte/core/popover';
import { Tabs } from '@kobalte/core/tabs';
import type { EntityData, ExpandedEntityType } from '@macro-entity';
import {
  queryKeys,
  useQueryClient as useEntityQueryClient,
} from '@macro-entity';
import IconGear from '@macro-icons/macro-gear.svg';
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
import { PreviewPanel } from './PreviewPanel';
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

false && fileFolderDrop;

// Entity type filter configuration
const ENTITY_TYPE_FILTERS: {
  kind: 'entityType' | 'channelCategory' | 'documentPreset';
  type?: ExpandedEntityType;
  channelCategory?: 'people' | 'groups';
  documentTypes?: Array<'md' | 'code' | 'image' | 'canvas' | 'pdf' | 'unknown'>;
  label: string;
  iconType: string;
  enabled: boolean;
  shortcut: string;
}[] = [
  {
    kind: 'documentPreset',
    type: 'document',
    documentTypes: ['md', 'canvas'],
    label: 'Docs',
    iconType: 'md',
    enabled: true,
    shortcut: 'd',
  },
  {
    kind: 'entityType',
    type: 'chat',
    label: 'Agents',
    iconType: 'chat',
    enabled: true,
    shortcut: 'a',
  },
  {
    kind: 'channelCategory',
    channelCategory: 'people',
    label: 'People',
    iconType: 'channel',
    enabled: true,
    shortcut: 'p',
  },
  {
    kind: 'channelCategory',
    channelCategory: 'groups',
    label: 'Teams',
    iconType: 'directMessage',
    enabled: true,
    shortcut: 'm',
  },
  {
    kind: 'entityType',
    type: 'task',
    label: 'Tasks',
    iconType: 'task',
    enabled: ENABLE_TASKS_TABS,
    shortcut: 't',
  },
  {
    kind: 'entityType',
    type: 'email',
    label: 'Mail',
    iconType: 'email',
    enabled: true,
    shortcut: 'l',
  },
  {
    kind: 'documentPreset',
    type: 'document',
    // "Files" = everything except Notes + Canvases
    documentTypes: ['code', 'image', 'pdf', 'unknown'],
    label: 'Files',
    iconType: 'project',
    enabled: true,
    shortcut: 'f',
  },
];

function EntityTypeIconFilter() {
  const renderShortcutUnderlinedInLabel = (label: string, shortcut: string) => {
    const s = shortcut.trim();
    if (!s) return label;
    if (s.toLowerCase() === 'space') {
      return (
        <>
          {label}
          <span class="ml-1 font-mono opacity-70">␣</span>
        </>
      );
    }
    if (s === '/') {
      return (
        <>
          {label}
          <span class="ml-1 font-mono opacity-70">/</span>
        </>
      );
    }

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

  const view = createMemo(() => viewsDataStore[selectedView()]);

  // Search state (must be after view is defined)
  let searchInputRef: HTMLInputElement | undefined;
  const searchText = createMemo(() => view()?.searchText ?? '');
  const setSearchText = (text: string) => {
    setViewDataStore(selectedView(), 'searchText', text);
  };

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

  const documentTypeFilter = createMemo(
    () =>
      view()?.filters?.documentTypeFilter ?? VIEWCONFIG_BASE.filters.documentTypeFilter
  );

  const sameSet = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const as = new Set(a);
    for (const item of b) {
      if (!as.has(item)) return false;
    }
    return true;
  };

  const isDocumentPresetActive = (types: string[]) => {
    const currentTypes = entityTypeFilter();
    if (currentTypes.length === 0) return false;
    if (!currentTypes.includes('document')) return false;
    return sameSet(documentTypeFilter(), types);
  };

  // Topbar filter behavior: only one of the ENTITY_TYPE_FILTERS can be active at a time.
  // (Inbox/unread are separate and can still be combined with the selected type filter.)
  const clearTopbarTypeFilters = () => {
    setViewDataStore(selectedView(), 'filters', 'typeFilter', []);
    setViewDataStore(selectedView(), 'filters', 'documentTypeFilter', []);
    setViewDataStore(selectedView(), 'filters', 'channelCategoryFilter', []);
  };

  const setExclusiveEntityTypeFilter = (type: ExpandedEntityType) => {
    const current = entityTypeFilter();
    const isActive = current.length === 1 && current[0] === type;

    batch(() => {
      if (isActive) {
        clearTopbarTypeFilters();
        return;
      }
      setViewDataStore(selectedView(), 'filters', 'typeFilter', [type]);
      setViewDataStore(selectedView(), 'filters', 'documentTypeFilter', []);
      setViewDataStore(selectedView(), 'filters', 'channelCategoryFilter', []);
    });
  };

  const toggleDocumentPreset = (
    preset: Array<'md' | 'code' | 'image' | 'canvas' | 'pdf' | 'unknown'>
  ) => {
    const active =
      entityTypeFilter().length === 1 && isDocumentPresetActive(preset);
    batch(() => {
      if (active) {
        clearTopbarTypeFilters();
        return;
      }
      setViewDataStore(selectedView(), 'filters', 'typeFilter', ['document']);
      setViewDataStore(selectedView(), 'filters', 'documentTypeFilter', preset);
      setViewDataStore(selectedView(), 'filters', 'channelCategoryFilter', []);
    });
  };

  const toggleChannelCategoryFilter = (category: 'people' | 'groups') => {
    batch(() => {
      const currentTypes = entityTypeFilter();
      const currentCats = channelCategoryFilter() ?? [];
      const isActive =
        currentTypes.length === 1 &&
        currentTypes[0] === 'channel' &&
        currentCats.length === 1 &&
        currentCats[0] === category;

      if (isActive) {
        clearTopbarTypeFilters();
        return;
      }

      setViewDataStore(selectedView(), 'filters', 'typeFilter', ['channel']);
      setViewDataStore(selectedView(), 'filters', 'channelCategoryFilter', [
        category,
      ]);
      setViewDataStore(selectedView(), 'filters', 'documentTypeFilter', []);
    });
  };

  const isInboxFilterActive = () => {
    const current = focusFilters() ?? [];
    return current.includes('signal') && !current.includes('noise');
  };

  // Simplified UI:
  // - Inbox ON  => equivalent to the old "Important" filter (signal)
  // - Inbox OFF => equivalent to no signal/noise filter applied
  const toggleInboxFilter = () => {
    batch(() => {
      if (isInboxFilterActive()) {
        setViewDataStore(selectedView(), 'filters', 'focusFilters', []);
        setViewDataStore(selectedView(), 'filters', 'notificationFilter', 'all');
        return;
      }

      setViewDataStore(selectedView(), 'filters', 'focusFilters', ['signal']);
      setViewDataStore(
        selectedView(),
        'filters',
        'notificationFilter',
        'notDone'
      );
    });
  };

  const isFilterActive = (type: ExpandedEntityType) => {
    const filter = entityTypeFilter();
    // If no filters are active, all types are shown (nothing is "active")
    if (filter.length === 0) return false;
    return filter.includes(type);
  };

  const isChannelCategoryActive = (category: 'people' | 'groups') => {
    const types = entityTypeFilter();
    if (types.length === 0) return false;
    if (!types.includes('channel')) return false;
    const cats = channelCategoryFilter() ?? [];
    // For the topbar we keep this exclusive: empty doesn't light up either option.
    if (cats.length === 0) return false;
    return cats.includes(category);
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
      setViewDataStore('all', 'filters', 'channelCategoryFilter', []);
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
    const currentSort = view()?.sort;
    setViewDataStore(selectedView(), 'sort', {
      type: 'systemSortOption',
      sortBy,
      sortOrder: currentSort?.sortOrder ?? 'ascending',
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
      hotkey: 'i',
      description: 'Toggle Inbox',
      handler: () => toggleInboxFilter(),
    },
    ...ENTITY_TYPE_FILTERS.filter((f) => f.enabled).map((f) => ({
      hotkey: f.shortcut as ValidHotkey,
      description: `Filter by ${f.label}`,
      handler: () => {
        if (f.kind === 'documentPreset') {
          toggleDocumentPreset(f.documentTypes!);
          return;
        }
        if (f.kind === 'channelCategory') {
          toggleChannelCategoryFilter(f.channelCategory!);
          return;
        }
        setExclusiveEntityTypeFilter(f.type!);
      },
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
        class="flex items-center h-full gap-0.5 pl-0.5 pr-1 overflow-x-auto scrollbar-hidden overscroll-none"
        ref={setScrollRef}
      >
        {/* Inbox toggle */}
        <div class="flex items-center mr-0.5 shrink-0">
          <Tooltip tooltip={<LabelAndHotKey label="Inbox" shortcut="i" />}>
            <button
              type="button"
              class="flex items-center gap-1.5 h-[22px] px-2.5 active:bg-accent active:text-panel rounded-full"
              classList={{
                'bg-accent text-panel': isInboxFilterActive(),
                'text-ink-muted hover:text-accent hover:bg-accent/20':
                  !isInboxFilterActive(),
              }}
              onClick={() => toggleInboxFilter()}
            >
              <SignalIcon class="size-4" />
              <span class="text-xs leading-none">
                {renderShortcutUnderlinedInLabel('Inbox', 'i')}
              </span>
            </button>
          </Tooltip>
        </div>
        <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
        {/* Unread filter */}
        <div class="flex items-center mr-0.5 shrink-0">
          <Tooltip tooltip={<LabelAndHotKey label="Unread Only" shortcut="u" />}>
            <button
              type="button"
              class="flex items-center gap-1.5 h-[22px] px-2.5 active:bg-accent active:text-panel rounded-full"
              classList={{
                'bg-accent text-panel': isUnreadFilterActive(),
                'text-ink-muted hover:text-accent hover:bg-accent/20':
                  !isUnreadFilterActive(),
              }}
              onClick={() => toggleUnreadFilter()}
            >
              <svg
                class="size-3.5"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="12" cy="12" r="4" />
              </svg>
              <span class="text-xs leading-none">
                {renderShortcutUnderlinedInLabel('Unread', 'u')}
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
              const isActive = () => {
                if (filter.kind === 'documentPreset') {
                  return isDocumentPresetActive(filter.documentTypes!);
                }
                if (filter.kind === 'channelCategory') {
                  return isChannelCategoryActive(filter.channelCategory!);
                }
                return isFilterActive(filter.type!);
              };

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
                    class="flex items-center gap-1.5 h-[22px] px-2.5 active:bg-accent active:text-panel rounded-full"
                    classList={{
                      'bg-accent text-panel': isActive(),
                      'text-ink-muted hover:text-accent hover:bg-accent/20':
                        !isActive(),
                    }}
                    onClick={() => {
                      if (filter.kind === 'documentPreset') {
                        toggleDocumentPreset(filter.documentTypes!);
                        return;
                      }
                      if (filter.kind === 'channelCategory') {
                        toggleChannelCategoryFilter(filter.channelCategory!);
                        return;
                      }
                      setExclusiveEntityTypeFilter(filter.type!);
                    }}
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
        </div>
        <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
        {/* Preview toggle */}
        <Tooltip
          tooltip={<LabelAndHotKey label="Toggle Preview" shortcut="space" />}
        >
          <button
            type="button"
            class="flex items-center gap-1.5 h-[22px] px-2.5 active:bg-accent active:text-panel rounded-full"
            classList={{
              'bg-accent text-panel': preview(),
              'text-ink-muted hover:text-accent hover:bg-accent/20': !preview(),
            }}
            onClick={() => {
              playSound('open');
              setPreview((prev) => !prev);
            }}
          >
            <PreviewIcon class="size-3.5" />
            <span class="text-xs leading-none">
              {renderShortcutUnderlinedInLabel('Preview', 'space')}
            </span>
          </button>
        </Tooltip>
        <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
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
            class="flex items-center gap-1.5 h-[22px] px-2.5 shrink-0 rounded-full active:bg-accent active:text-panel"
            classList={{
              'bg-accent text-panel': sortDropdownOpen(),
              'text-ink-muted hover:text-accent hover:bg-accent/20':
                !sortDropdownOpen(),
            }}
          >
            <SortIcon class="size-3.5" />
            <span class="text-xs leading-none">
              {renderShortcutUnderlinedInLabel('Sort', 's')}
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
        <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
        {/* Compact search bar */}
        <div class="flex items-center gap-1 shrink-0">
          <Tooltip tooltip={<LabelAndHotKey label="Search" shortcut="⌘F" />}>
            <div
              class="relative flex items-center gap-1.5 h-[22px] px-2.5 rounded-full transition-colors"
              classList={{
                'bg-accent text-panel': !!searchText(),
                'text-ink-muted hover:text-accent hover:bg-accent/20': !searchText(),
              }}
            >
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
                class="w-24 p-0 text-xs bg-transparent border-none outline-none ring-0 focus:outline-none focus:ring-0 placeholder:text-ink-muted placeholder:select-none"
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
        class="flex items-center gap-1.5 h-[22px] px-2.5 rounded-full text-ink-muted hover:text-accent hover:bg-accent/20 active:bg-accent active:text-panel"
        onClick={clearAllFilters}
      >
        <span class="text-sm leading-none">✕</span>
        <span class="text-xs leading-none">
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
          <IconGear class="size-3.5" />
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
            <UnifiedListView hideToolbar />
          </SuspenseContextComp>
        </Match>
      </Switch>
    </ViewTab>
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
    </div>
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
