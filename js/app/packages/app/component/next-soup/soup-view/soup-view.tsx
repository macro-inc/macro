import CheckIcon from '@icon/bold/check-bold.svg';
import Spinner from '@icon/regular/spinner.svg';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { EntityRow, EntityRowProvider } from '@app/component/mobile/EntityRow';
import {
  makeMarkDoneAction,
  useEntityActionHotkeys,
} from '@app/component/next-soup/actions';
import { useSoup } from '@app/component/next-soup/soup-context';
import { SoupEntityContextMenu } from '@app/component/next-soup/soup-view/soup-entity-context-menu';
import {
  type SoupRow,
  SoupViewContextProvider,
  useSoupView,
} from '@app/component/next-soup/soup-view/soup-view-context';
import { useSoupNavigationHotkeys } from './use-soup-navigation-hotkeys';
import { useSoupViewHotkeys } from './use-soup-view-hotkeys';
import { registerPreviewEntity } from '@app/signal/splitLayout';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import {
  openEntityInNewTab,
  openEntityInSplitFromUnifiedList,
} from '@app/component/next-soup/utils';
import {
  PreviewPanel,
  useMaybePreviewPanel,
} from '@app/component/PreviewPanel';
import { SplitPanelContext } from '@app/component/split-layout/context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { CollapsibleHeaderItem } from '@app/component/split-layout/components/CollapsibleHeaderItem';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import {
  type EntityData,
  ListEntity,
  ListLayoutProvider,
  type SearchLocation,
  type ProjectEntity,
} from '@entity';
import { useQueryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import { createEffectOnEntityTypeNotification } from '@notifications';
import { debounce } from '@solid-primitives/scheduled';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { SoupEntitySelectionToolbar } from './soup-entity-selection-toolbar';
import { useUserId } from '@core/context/user';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { SoupViewFileDropzone } from '@app/component/next-soup/soup-view/soup-view-file-dropzone';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { invalidateEntityNotifications } from '@queries/notification/user-notifications';
import type { CacheSnapshot } from 'virtua/unstable_core';
import { EmptyState } from '@app/component/next-soup/soup-view/empty-states';
import { SoupChatInput } from '@app/component/SoupChatInput';
import { ENABLE_UNIFIED_LIST_AI_INPUT } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import type { SystemSortOption } from '@app/component/next-soup/soup-view/sort-options';

import type { SoupItemsQueryFilters } from '@queries/soup/items';
import type { FilterID } from '@app/component/next-soup/filters';
import {
  SoupViewTabs,
  useApplyPreset,
} from '@app/component/next-soup/soup-view/soup-view-tabs';
import { SoupViewCreateButton } from '@app/component/next-soup/soup-view/soup-view-create-button';
import { isListViewID, type ListView } from '@app/constants/list-views';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { SoupSearchbar } from '@app/component/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { SoupFiltersBar } from '@app/component/next-soup/soup-view/filters-bar/soup-filters-bar';
import { useFilterRefinements } from '@app/component/next-soup/soup-view/filters-bar/use-filter-refinements';
import {
  invalidateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/normalized-cache';
import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';

const useSoupNotificationInvalidators = () => {
  const notificationSource = useGlobalNotificationSource();
  const entityQueryClient = useQueryClient();

  createEffectOnEntityTypeNotification(
    notificationSource,
    'channel',
    (notification) => {
      refetchSoupEntity(notification.entity_id, 'channel');
      invalidateSoupEntity(notification.entity_id);
      invalidateEntityNotifications(notification.entity_id);
    }
  );

  createEffectOnEntityTypeNotification(
    notificationSource,
    'email_thread',
    (notification) => {
      refetchSoupEntity(notification.entity_id, 'emailThread');
      invalidateSoupEntity(notification.entity_id);
      // invalidate thread cache so thread gets fetched (with new message) on next load
      entityQueryClient.invalidateQueries({
        queryKey: emailKeys.threadMessages(notification.entity_id).queryKey,
      });
    }
  );

  createEffectOnEntityTypeNotification(
    notificationSource,
    'document',
    (notification) => {
      if (notification.notification_event_type === 'task_assigned') {
        refetchSoupEntity(notification.entity_id, 'document');
        invalidateSoupEntity(notification.entity_id);
        invalidateEntityNotifications(notification.entity_id);
      }
    }
  );
};

const stateCache = new Map<
  string,
  {
    soup: {
      focus: string | undefined;
      filters: { and: string[]; or: string[] };
      queryFilters: SoupItemsQueryFilters;
      sort: SystemSortOption[];
      searchText: string;
      activeTab: string | undefined;
    };
    virtualCache?: CacheSnapshot;
    scrollOffset?: number;
  }
>();

interface SoupViewProps {
  viewName: string;
  initialClientFilters?: { and?: FilterID[]; or?: FilterID[] };
  queryFilters?: SoupItemsQueryFilters;
}

export const SoupView = (props: SoupViewProps) => {
  const soup = useSoup();
  const panel = useSplitPanelOrThrow();

  useSoupNotificationInvalidators();

  onMount(() => {
    if (!props.initialClientFilters) return;

    soup.filters.set(props.initialClientFilters);
  });

  const component = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  const [narrowSearchExpanded, setNarrowSearchExpanded] = createSignal(false);

  return (
    <SplitPanelContext.Provider
      value={{
        ...panel,
        halfSplitState: () =>
          soup.previewEntity() ? { side: 'left', percentage: 30 } : undefined,
      }}
    >
      <SoupViewContextProvider soup={soup} queryFilters={props.queryFilters}>
        <div class="size-full flex flex-col">
          <div class="flex flex-col w-full">
            <SplitHeaderLeft>
              <div
                class={cn('h-full flex gap-3 items-center', {
                  'shrink-0': !narrowSearchExpanded(),
                  'flex-1 min-w-0': narrowSearchExpanded(),
                })}
              >
                <Show when={!isMobile()}>
                  <h1 class="font-medium text-ink-muted select-none text-sm shrink-0">
                    {props.viewName}
                  </h1>
                </Show>
                <Show when={!narrowSearchExpanded()}>
                  <SoupViewTabs />
                  <SoupViewCreateButton />
                </Show>
                <Show when={narrowSearchExpanded()}>
                  <div class="flex-1 min-w-0">
                    <SoupSearchbar
                      variant="secondary"
                      autoFocus
                      onDismiss={() => setNarrowSearchExpanded(false)}
                    />
                  </div>
                </Show>
              </div>
            </SplitHeaderLeft>
            <SplitHeaderRight>
              <Show when={!isComponentListView('search')}>
                <CollapsibleHeaderItem
                  id="search"
                  priority={0}
                  onCollapsedChange={(isCollapsed) => {
                    if (!isCollapsed) setNarrowSearchExpanded(false);
                  }}
                  expanded={
                    <div class="w-52">
                      <SoupSearchbar variant="secondary" />
                    </div>
                  }
                  collapsed={
                    <Show when={!narrowSearchExpanded()}>
                      <Tooltip
                        tooltip={
                          <LabelAndHotKey label="Search" shortcut="⌘F" />
                        }
                      >
                        <Button
                          variant="ghost"
                          class="p-1 rounded-xs"
                          onClick={() => setNarrowSearchExpanded(true)}
                        >
                          <SearchIcon class="size-4" />
                        </Button>
                      </Tooltip>
                    </Show>
                  }
                />
              </Show>
            </SplitHeaderRight>
            <SoupFiltersBar />
          </div>
          <div class="relative flex-grow min-h-1 flex max-sm:flex-col flex-row size-full">
            <Suspense>
              <SoupViewFileDropzone>
                <SoupViewList />
              </SoupViewFileDropzone>
            </Suspense>
          </div>
        </div>
        <Suspense>
          <Show when={ENABLE_UNIFIED_LIST_AI_INPUT && !isMobile()}>
            <SoupChatInput />
          </Show>
        </Suspense>
      </SoupViewContextProvider>
    </SplitPanelContext.Provider>
  );
};

interface SoupViewListProps {
  customScrollbarHidden?: boolean;
  scopeId?: string;
}

export const SoupViewList = (props: SoupViewListProps) => {
  const panel = useSplitPanelOrThrow();
  const {
    soup,
    source,
    rows,
    searchText,
    setSearchText,
    setQueryFilters,
    queryFilters,
    featuredIds,
    isSearchServiceLoading,
    isLocalSearchSettling,
    activeTab,
    setActiveTab,
  } = useSoupView();
  const { getSplitCount } = useSplitLayout();
  const { hasActiveRefinements, resetToTabDefaults } = useFilterRefinements();

  const { isKeypressActive } = useIsKeyPressActive();

  const [virtualizerHandle, setVirtualizerHandle] =
    createSignal<VirtualizerHandle>();

  const [soupViewRef, setSoupViewRef] = createSignal<HTMLElement | undefined>();

  const [previewPanelRef, setPreviewPanelRef] = createSignal<
    HTMLElement | undefined
  >();

  const focusFirstEntity = () => {
    const next = soup.navigate.toFirst();

    if (next) {
      virtualizerHandle()?.scrollToIndex(next.index, { align: 'nearest' });
    }
  };

  const [focusEffectsEnabled, setFocusEffectsEnabled] = createSignal(false);
  const [moveInitialFocus, setMoveInitialFocus] = createSignal(true);

  let initialLoad = true;

  // Initial load: focus first entity once rows arrive
  createEffect(
    on(rows, () => {
      if (!focusEffectsEnabled() || !moveInitialFocus()) return;
      if (!initialLoad || source.isLoading()) return;
      focusFirstEntity();
      initialLoad = false;
    })
  );

  // Focus first entity on filter/search changes
  createEffect(
    on(
      () => [soup.filters.activeIds(), searchText(), featuredIds()] as const,
      () => {
        if (!focusEffectsEnabled()) return;
        focusFirstEntity();
      },
      { defer: true }
    )
  );

  const registerFocusEffects = (shouldMoveInitialFocus = true) => {
    setMoveInitialFocus(shouldMoveInitialFocus);
    setFocusEffectsEnabled(true);
  };

  const previewPanel = useMaybePreviewPanel();

  // Auto focus the soup on mount except when it's in a preview panel
  createEffect(() => {
    if (previewPanel) return;

    soupViewRef()?.focus();
  });

  const [attachHotkeys, soupViewScope] = useHotkeyDOMScope('soup-view');

  const scopeId = createMemo(() => {
    return previewPanel
      ? soupViewScope
      : (props.scopeId ?? panel.splitHotkeyScope);
  });

  // Register navigation hotkeys
  useSoupNavigationHotkeys({
    scopeId: scopeId(),
    soup,
    splitHandle: panel.handle,
    virtualizerHandle,
    previewPanelRef,
  });

  // Register entity action hotkeys
  useEntityActionHotkeys({
    scopeId: scopeId(),
    soup,
    splitHandle: panel.handle,
  });

  // Register soup view hotkeys (jump navigation, enter, escape, cmd+k, etc.)
  const { applyTabPreset } = useApplyPreset();
  const currentView = () => {
    const { type, id } = panel.handle.content();
    if (type !== 'component') return;
    return isListViewID(id) ? id : undefined;
  };

  useSoupViewHotkeys({
    splitId: panel.handle.id,
    scopeId: scopeId(),
    soup,
    splitHandle: panel.handle,
    virtualizerHandle,
    previewState: () => !!soup.previewEntity(),
    getSplitCount,
    currentView,
    activeTab,
    applyTabPreset,
  });

  // Register previewed entity for auto-attach
  createEffect(() => {
    const entity = soup.previewEntity() ? soup.focus.item() : undefined;
    if (!entity) {
      registerPreviewEntity(panel.handle.id, undefined);
      return;
    }
    const type =
      entity.type === 'document'
        ? fileTypeToResolvedBlockName(
            (entity as { fileType?: string }).fileType
          )
        : entity.type;
    registerPreviewEntity(panel.handle.id, { type, id: entity.id });
  });
  onCleanup(() => {
    registerPreviewEntity(panel.handle.id, undefined);
  });

  // Create markDone action for swipe/click handlers
  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();

  const markDoneAction = makeMarkDoneAction({
    userId,
    notificationSource: () => notificationSource,
  });

  const debouncedFetchMore = debounce(() => {
    if (
      source.isFetching() ||
      source.isFetchingNextPage() ||
      !source.hasNextPage()
    )
      return;

    source.fetchNextPage();
  }, 15);

  const orchestrator = useGlobalBlockOrchestrator();

  type EntityClickArgs = {
    type: 'entity' | 'project';
    entity: EntityData;
    projectEntity?: ProjectEntity;
    event: MouseEvent | PointerEvent;
    location?: SearchLocation;
  };

  const onEntityClick = async (args: EntityClickArgs) => {
    const { type, event, location } = args;

    const entity = (
      type === 'entity' ? args.entity : args.projectEntity
    ) as EntityData;

    if (event.metaKey || event.ctrlKey) {
      openEntityInNewTab({ entity, location });
      return;
    }

    if (soup.previewEntity() && type === 'entity') {
      soup.focus.set(entity.id);
      return;
    }

    await openEntityInSplitFromUnifiedList(entity, {
      openInNewSplit: event.shiftKey,
      location,
      splitHandle: panel.handle,
    });
  };

  let lastClickedEntityId = -1;

  const getSelectionAnchorIndex = (params: {
    entities: SoupRow[];
    lastClickedIndex: number;
  }) => {
    // Try to grab the last clicked item and fall back on the highest currently
    // selected index.
    let anchorIndex = params.lastClickedIndex;
    if (anchorIndex === -1) {
      for (let i = 0; i < params.entities.length; i++) {
        if (params.entities[i].isSelected()) {
          anchorIndex = i;
        }
      }
    }
    return anchorIndex;
  };

  const handleMultiSelectChecked = (params: {
    entity: EntityData;
    entityIndex: number;
    next: boolean;
    shiftKey: boolean;
  }) => {
    if (!params.shiftKey) {
      soup.selection.toggle(params.entity);
      lastClickedEntityId = params.entityIndex;
      return;
    }

    const entityList = rows();

    const anchorIndex = getSelectionAnchorIndex({
      entities: entityList,
      lastClickedIndex: lastClickedEntityId,
    });

    if (anchorIndex === -1) {
      soup.selection.toggle(params.entity);
      lastClickedEntityId = params.entityIndex;
      return;
    }

    const newEntitiesForSelection = [];
    const sign = Math.sign(params.entityIndex - anchorIndex);

    for (
      let i = anchorIndex;
      sign > 0 ? i <= params.entityIndex : i >= params.entityIndex;
      i += sign
    ) {
      const entity = entityList[i];
      if (!entity.isSelected()) {
        newEntitiesForSelection.push(entity.original);
      }
    }

    soup.selection.selectRange(newEntitiesForSelection);

    lastClickedEntityId = params.entityIndex;
  };

  // reset last clicked on reset multi-selection.
  createEffect(() => {
    if (soup.selection.count() === 0) {
      lastClickedEntityId = -1;
    }
  });

  const [localEntityListRef, setLocalEntityListRef] = createSignal<
    HTMLDivElement | undefined
  >();

  const entityById = createMemo(
    () => {
      const list = rows() ?? [];
      const map = new Map<string, SoupRow>();
      for (const entity of list) {
        map.set(entity.original.id, entity);
      }
      return map;
    },
    new Map<string, SoupRow>(),
    {
      equals(prev, next) {
        return prev.size === next.size;
      },
    }
  );

  const isProjectList = panel.handle.content().type === 'project';

  let key = `soup-view-${panel.handle.id}-${panel.handle.content().id}`;

  if (previewPanel) {
    key += '-preview';
  }

  const getCacheKey = () => {
    return key;
  };

  onCleanup(() => {
    const virtualHandle = virtualizerHandle();

    if (isProjectList) return;

    stateCache.set(getCacheKey(), {
      soup: {
        focus: soup.focus.id(),
        filters: {
          and: [...soup.filters.andFilters().map((f) => f.id)],
          or: [...soup.filters.orFilters().map((f) => f.id)],
        },
        queryFilters: queryFilters(),
        sort: soup.sort.active().map((s) => s.id),
        searchText: searchText(),
        activeTab: activeTab(),
      },
      virtualCache: virtualHandle?.cache,
      scrollOffset: virtualHandle?.scrollOffset,
    });
  });

  let restored = false;
  const restoreState = () => {
    if (restored || isProjectList) return;

    restored = true;

    const cached = stateCache.get(getCacheKey());

    if (!cached) {
      registerFocusEffects();
      return;
    }

    soup.focus.set(cached.soup.focus);

    soup.filters.set(cached.soup.filters);

    setQueryFilters(cached.soup.queryFilters);
    setSearchText(cached.soup.searchText);

    soup.sort.setAll(cached.soup.sort);

    setActiveTab(cached.soup.activeTab);

    virtualizerHandle()?.scrollTo(cached.scrollOffset ?? 0);
    registerFocusEffects(false);
  };

  const registerVirtualizerHandler = (
    handle: VirtualizerHandle | undefined
  ) => {
    setVirtualizerHandle(handle);

    restoreState();
  };

  const featuredCount = createMemo(() => featuredIds().length);

  return (
    <div
      class="size-full flex bracket-never"
      ref={(el) => {
        setSoupViewRef(el);
        attachHotkeys(el);
      }}
      tabIndex={-1}
      onFocusIn={(e) => {
        e.stopPropagation();
      }}
      data-hotkey-scope={soupViewScope}
      data-soup-view
      data-soup-view-id={panel.handle.id + (previewPanel ? '-preview' : '')}
    >
      <div
        class="@container/uList size-full unified-list-root flex flex-col"
        classList={{
          'border-r border-edge-muted': soup.previewEntity() !== undefined,
        }}
      >
        <StaticMarkdownContext>
          <Switch>
            <Match when={source.isLoading() && !rows().length}>
              <LoadingBlock />
            </Match>
            <Match
              when={
                (isSearchServiceLoading() || isLocalSearchSettling()) &&
                !rows().length
              }
            >
              <div class="flex items-center gap-2 px-3 py-3 text-xs text-text-muted">
                <Spinner class="size-3 animate-spin" />
                Searching...
              </div>
            </Match>
            <Match when={!rows().length}>
              <EmptyState
                search={!!searchText()}
                hasRefinementsFromBase={hasActiveRefinements()}
                onClearFilters={resetToTabDefaults}
              />
            </Match>
            <Match when={rows().length}>
              <ListLayoutProvider ref={localEntityListRef}>
                <EntityRowProvider
                  container={localEntityListRef}
                  canSwipeLeft={(entityId) => {
                    const entity = entityById().get(entityId);
                    if (!entity) return false;
                    return markDoneAction.canExecute(entity.original);
                  }}
                  onSwipeLeft={(entityId) => {
                    const entity = entityById().get(entityId);
                    if (!entity) return;
                    markDoneAction.executeWithSoup([entity.original], soup);
                  }}
                  setCollapseEntity={soup.collapseEntity.set}
                >
                  <SoupList
                    cache={stateCache.get(getCacheKey())?.virtualCache}
                    ref={setLocalEntityListRef}
                    virtualizerClass="scrollbar-hidden"
                    class="overflow-hidden flex min-w-0"
                    virtualizerRef={registerVirtualizerHandler}
                    onScrollBottom={debouncedFetchMore}
                    scrollBottomOffset={300}
                    rows={rows()}
                  >
                    {(row, i) => {
                      const timestamp = () => {
                        const sort_ = soup.sort.active();
                        if (!sort_.length) return;

                        switch (sort_[0].id) {
                          case 'viewed_at':
                            return row.original.viewedAt;
                          case 'created_at':
                            return row.original.createdAt;
                          case 'updated_at':
                            return row.original.updatedAt;
                          default:
                            return row.original.createdAt;
                        }
                      };

                      return (
                        <>
                          <Show when={i() === 0 && featuredCount() > 0}>
                            <div class="px-3 py-1.5 text-xs text-text-muted font-medium">
                              Featured Results
                            </div>
                          </Show>
                          <Show
                            when={
                              i() === featuredCount() && featuredCount() > 0
                            }
                          >
                            <div class="px-3 py-1.5 text-xs text-text-muted font-medium border-t border-edge-muted mt-1">
                              More Results
                            </div>
                          </Show>
                          <EntityRow
                            entityId={row.original.id}
                            swipeLeftColor="bg-success"
                            swipeLeftRevealedComponent={
                              <CheckIcon class="size-8 text-panel" />
                            }
                          >
                            <SoupEntityContextMenu
                              entity={row.original}
                              entityTimestamp={timestamp()}
                            >
                              <ListEntity
                                entity={row.original}
                                timestamp={timestamp()}
                                highlighted={
                                  panel.isPanelActive() && row.isFocused()
                                }
                                onMouseMove={() => {
                                  if (isKeypressActive()) return;
                                  if (soup.previewEntity()) return;
                                  soup.focus.set(row.original.id);
                                }}
                                showUnrollNotifications={
                                  soup.filters.isActive('signal') &&
                                  !soup.filters.isActive('noise')
                                }
                                checked={row.isSelected()}
                                onChecked={(next: boolean, shiftKey: boolean) =>
                                  handleMultiSelectChecked({
                                    entity: row.original,
                                    entityIndex: i(),
                                    next,
                                    shiftKey: shiftKey ?? false,
                                  })
                                }
                                onClick={(event: MouseEvent) => {
                                  onEntityClick({
                                    type: 'entity',
                                    entity: row.original,
                                    event,
                                    location: undefined,
                                  });
                                }}
                                onProjectClick={(projectEntity, event) => {
                                  onEntityClick({
                                    type: 'project',
                                    projectEntity,
                                    entity: row.original,
                                    event,
                                    location: undefined,
                                  });
                                }}
                                onContentHitClick={(
                                  e: PointerEvent | MouseEvent,
                                  location?: SearchLocation
                                ) => {
                                  onEntityClick({
                                    type: 'entity',
                                    entity: row.original,
                                    event: e,
                                    location,
                                  });
                                }}
                              />
                            </SoupEntityContextMenu>
                          </EntityRow>
                          <Show
                            when={
                              i() === rows().length - 1 &&
                              isSearchServiceLoading()
                            }
                          >
                            <div class="flex items-center gap-2 px-3 py-3 text-xs text-text-muted">
                              <Spinner class="size-3 animate-spin" />
                              Searching...
                            </div>
                          </Show>
                        </>
                      );
                    }}
                  </SoupList>
                </EntityRowProvider>
              </ListLayoutProvider>

              <Show when={!props.customScrollbarHidden}>
                <CustomScrollbar
                  scrollContainer={() => {
                    // Find the actual scroll container (VList creates its own scroll container)
                    const listEl = localEntityListRef();
                    if (!listEl) return undefined;
                    const scrollContainer = listEl.querySelector(
                      '[data-soup-list-container]'
                    ) as HTMLElement;
                    return scrollContainer || undefined;
                  }}
                />
              </Show>
            </Match>
          </Switch>
        </StaticMarkdownContext>
      </div>
      <Show when={soup.selection.count() > 0}>
        <SoupEntitySelectionToolbar
          selected={soup.selection.selected()}
          onClose={soup.selection.clear}
          onClear={soup.selection.clear}
        />
      </Show>
      <Show when={soup.previewEntity() || panel.previewState[0]()}>
        <PreviewPanel
          ref={setPreviewPanelRef}
          selectedEntity={soup.focus.item()}
          orchestrator={orchestrator}
          splitPanelContext={panel}
          onFocusOut={() => {
            soupViewRef()?.focus();
          }}
        />
      </Show>
    </div>
  );
};

const DEFAULT_ITEM_SIZE = 10;
const DEFAULT_OVERSCAN = 5;

interface SoupListProps {
  ref?: (el: HTMLElement) => void;
  virtualizerRef?: (handle: VirtualizerHandle) => void;
  class?: string;
  virtualizerClass?: string;
  itemSize?: number;
  overscan?: number;
  children: (row: SoupRow, index: Accessor<number>) => JSX.Element;
  onScrollBottom?: VoidFunction;
  scrollBottomOffset?: number;
  rows: SoupRow[];
  cache?: CacheSnapshot;
}

const SoupList = (props: SoupListProps) => {
  const [virtualizerHandle, setVirtualizerHandle] =
    createSignal<VirtualizerHandle>();

  const itemSize = createMemo(() => props.itemSize ?? DEFAULT_ITEM_SIZE);
  const overscan = createMemo(() => props.overscan ?? DEFAULT_OVERSCAN);

  const [stableRows, setStableRows] = createStore<SoupRow[]>([]);

  createRenderEffect(() => {
    setStableRows(reconcile(props.rows, { key: 'id' }));
  });

  const handleScroll = (offset: number) => {
    const handle = virtualizerHandle();

    if (!handle) return;

    if (
      handle.scrollSize - handle.viewportSize - offset <=
      (props.scrollBottomOffset ?? 100)
    ) {
      props.onScrollBottom?.();
    }
  };

  const registerVirtualizerHandler = (
    handle: VirtualizerHandle | undefined
  ) => {
    setVirtualizerHandle(handle);

    if (handle) {
      props.virtualizerRef?.(handle);
    }
  };

  return (
    <div
      ref={props.ref}
      class={cn('unified-table-body size-full relative', props.class)}
    >
      <VList
        cache={props.cache}
        ref={registerVirtualizerHandler}
        class={props.virtualizerClass}
        data={stableRows}
        itemSize={itemSize()}
        bufferSize={overscan() * itemSize()}
        onScroll={handleScroll}
        data-soup-list-container
      >
        {(row, i) => props.children(row, i)}
      </VList>
    </div>
  );
};
