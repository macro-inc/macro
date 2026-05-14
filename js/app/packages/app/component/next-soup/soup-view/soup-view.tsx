import { VIEW_TAB_PRESETS } from '@app/component/app-sidebar/soup-filter-presets';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { EntityRowProvider } from '@app/component/mobile/EntityRow';
import {
  makeMarkDoneAction,
  useEntityActionHotkeys,
} from '@app/component/next-soup/actions';
import { canExecuteMarkDoneOnView } from '@app/component/next-soup/actions/make-mark-done-action';
import type { SoupRow } from '@app/component/next-soup/create-soup-state';
import type { QueryState } from '@app/component/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/component/next-soup/filters/filter-store/predicates-store';
import { useSoup } from '@app/component/next-soup/soup-context';
import { EmptyState } from '@app/component/next-soup/soup-view/empty-states';
import { MobileFilterDrawer } from '@app/component/next-soup/soup-view/filters-bar/mobile-filter-drawer';
import { SoupFiltersBar } from '@app/component/next-soup/soup-view/filters-bar/soup-filters-bar';
import { SoupSearchbar } from '@app/component/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { useFilterRefinements } from '@app/component/next-soup/soup-view/filters-bar/use-filter-refinements';
import { MaybeSoupEntityActionDrawerManager } from '@app/component/next-soup/soup-view/SoupEntityActionDrawerManager';
import type { SystemSortOption } from '@app/component/next-soup/soup-view/sort-options';
import { SoupEntityContextMenu } from '@app/component/next-soup/soup-view/soup-entity-context-menu';
import {
  activeSoupViewCounts,
  soupViewCacheKey,
} from '@app/component/next-soup/soup-view/soup-view-cache-key';
import {
  SoupViewContextProvider,
  useSoupView,
} from '@app/component/next-soup/soup-view/soup-view-context';
import { SoupViewCreateButton } from '@app/component/next-soup/soup-view/soup-view-create-button';
import { SoupViewFileDropzone } from '@app/component/next-soup/soup-view/soup-view-file-dropzone';
import { SoupViewMobileCreateButton } from '@app/component/next-soup/soup-view/soup-view-mobile-create-button';
import {
  CollapsedSoupViewTabs,
  MobileSoupViewTabs,
  SoupViewTabs,
  useApplyPreset,
} from '@app/component/next-soup/soup-view/soup-view-tabs';
import { TaskListEntity } from '@app/component/next-soup/soup-view/views/tasks/TaskListEntity';
import { ResponsiveTaskListHeader } from '@app/component/next-soup/soup-view/views/tasks/TaskListHeader';
import {
  openEntityInNewTab,
  openEntityInSplitFromUnifiedList,
} from '@app/component/next-soup/utils';
import {
  PreviewPanel,
  useMaybePreviewPanel,
} from '@app/component/PreviewPanel';
import { SoupChatInput } from '@app/component/SoupChatInput';
import { SettingsButton } from '@app/component/settings/SettingsButton';
import { CollapsibleHeaderItem } from '@app/component/split-layout/components/CollapsibleHeaderItem';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { SplitPanelContext } from '@app/component/split-layout/context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { EmailPermissionsBanner } from '@core/component/EmailPermissionsBanner';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { Resize } from '@core/component/Resize';
import { ENABLE_UNIFIED_LIST_AI_INPUT } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import {
  type EntityData,
  ListEntity,
  ListLayoutProvider,
  type ProjectEntity,
  type SearchLocation,
} from '@entity';
import CheckIcon from '@icon/bold/check-bold.svg';
import Spinner from '@icon/regular/spinner.svg';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import { createEffectOnEntityTypeNotification } from '@notifications';
import { useQueryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import { useEmailLinksQuery } from '@queries/email/link';
import { invalidateEntityNotifications } from '@queries/notification/user-notifications';
import {
  invalidateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/normalized-cache';
import { debounce } from '@solid-primitives/scheduled';
import { makePersisted } from '@solid-primitives/storage';
import { Button, cn, Tooltip } from '@ui';
import {
  type Accessor,
  batch,
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
  untrack,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import type { CacheSnapshot } from 'virtua/unstable_core';
import { SoupEntitySelectionToolbar } from './soup-entity-selection-toolbar';
import { useSoupNavigationHotkeys } from './use-soup-navigation-hotkeys';
import { useSoupViewHotkeys } from './use-soup-view-hotkeys';

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
    'chat',
    (notification) => {
      refetchSoupEntity(notification.entity_id, 'chat');
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

type PersistedSoupViewState = {
  version?: number;
  activeTab: string | undefined;
  filters: SetPredicatesInput<string>;
  queryFilters: Partial<QueryState>;
  sort: SystemSortOption[];
  previewEntity: string | undefined;
  assigneeFilter: string[];
  groupBy: string | undefined;
  collapsedGroups: string[];
};

const PERSISTED_STATE_VERSION = 7;

const listStateCache = new Map<
  string,
  {
    focus: string | undefined;
    searchText: string;
    virtualCache?: CacheSnapshot;
    scrollOffset?: number;
  }
>();

interface SoupViewProps {
  viewName: string;
  initialClientFilters?: SetPredicatesInput<string>;
  initialFilters?: Partial<QueryState>;
  initialSearchText?: string;
  /** Ignore localStorage on mount and use the supplied `initial*` values. */
  skipPersistedState?: boolean;
  disableLocalSearch?: boolean;
  /**
   * Client-side entities to merge into the soup results. Useful for entity
   * types (e.g. automation) that don't come back from the soup API.
   * Visibility is controlled by the active client filter set — use a tab
   * preset whose `clientFilters` include a predicate that matches them.
   */
  additionalEntities?: Accessor<EntityData[]>;
}

export const SoupView = (props: SoupViewProps) => {
  const soup = useSoup();
  const panel = useSplitPanelOrThrow();

  createEffect(() => {
    panel.handle.setDisplayName(props.viewName);
  });

  useSoupNotificationInvalidators();

  const component = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  const activeListView = createMemo<ListView | undefined>(() => {
    const id = component();
    return id && isListViewID(id) ? id : undefined;
  });

  const [narrowSearchExpanded, setNarrowSearchExpanded] = createSignal(false);
  const [searchIsCollapsed, setSearchIsCollapsed] = createSignal(false);

  registerHotkey({
    hotkey: 'cmd+f',
    hotkeyToken: TOKENS.soup.openSearch,
    scopeId: panel.splitHotkeyScope,
    registrationType: 'add',
    description: 'Search',
    keyDownHandler: () => {
      if (narrowSearchExpanded() || !searchIsCollapsed()) return false;
      setNarrowSearchExpanded(true);
      return true;
    },
  });

  const isMailView = createMemo(() => {
    const content = panel.handle.content();
    return content.type === 'component' && content.id === 'mail';
  });

  const emailLinksQuery = useEmailLinksQuery();
  const hasLinkError = createMemo(() => {
    if (!isMailView()) return false;
    if (emailLinksQuery.isPending) return false;
    return (
      emailLinksQuery.isError ||
      (emailLinksQuery.data && emailLinksQuery.data.links.length === 0)
    );
  });

  return (
    <SplitPanelContext.Provider
      value={{
        ...panel,
        halfSplitState: () =>
          soup.previewEntity() && soup.focus.item()
            ? { side: 'left', percentage: 30 }
            : undefined,
      }}
    >
      <SoupViewContextProvider
        soup={soup}
        initialQuery={props.initialFilters}
        initialSearchText={props.initialSearchText}
        disableLocalSearch={props.disableLocalSearch}
        additionalEntities={props.additionalEntities}
      >
        <div class="size-full flex flex-col">
          <div class="flex flex-col w-full">
            <SplitHeaderLeft>
              <div
                class={cn('h-full flex gap-3 items-center', {
                  'shrink-0': !narrowSearchExpanded(),
                  'flex-1 min-w-0': narrowSearchExpanded(),
                })}
              >
                <Show
                  when={
                    !narrowSearchExpanded() && !isComponentListView('search')
                  }
                >
                  <Show when={!isMobile()}>
                    <CollapsibleHeaderItem
                      id="tabs"
                      priority={1}
                      expanded={() => <SoupViewTabs />}
                      collapsed={() => <CollapsedSoupViewTabs />}
                      containerClass="h-full"
                    />
                  </Show>
                  <Show when={!isMobile()}>
                    <SoupViewCreateButton />
                  </Show>
                  <Show when={isMobile()}>
                    <MobileFilterDrawer />
                  </Show>
                </Show>
              </div>
            </SplitHeaderLeft>
            <SplitHeaderRight>
              <Show when={isMobile() && !narrowSearchExpanded()}>
                <SettingsButton />
              </Show>
              <Show when={narrowSearchExpanded()}>
                <div class="flex-1 min-w-0">
                  <SoupSearchbar
                    variant="secondary"
                    autoFocus
                    initialValue={props.initialSearchText}
                    onDismiss={() => setNarrowSearchExpanded(false)}
                  />
                </div>
              </Show>
              <Show
                when={!isComponentListView('search')}
                fallback={
                  <div class="grow ml-2">
                    <SoupSearchbar
                      variant="secondary"
                      placeholder="Search, @mention contacts"
                      initialValue={props.initialSearchText}
                    />
                  </div>
                }
              >
                <CollapsibleHeaderItem
                  id="search"
                  priority={0}
                  onCollapsedChange={(isCollapsed) => {
                    setSearchIsCollapsed(isCollapsed);
                    if (!isCollapsed) setNarrowSearchExpanded(false);
                  }}
                  expanded={() => (
                    <div class="w-60">
                      <SoupSearchbar
                        variant="secondary"
                        initialValue={props.initialSearchText}
                      />
                    </div>
                  )}
                  collapsed={() => (
                    <Show when={!narrowSearchExpanded()}>
                      <Tooltip label="Search" hotkey={TOKENS.soup.openSearch}>
                        <Button
                          variant="ghost"
                          class="p-1 rounded-xs"
                          onClick={() => setNarrowSearchExpanded(true)}
                        >
                          <SearchIcon class="size-4 touch:size-6" />
                        </Button>
                      </Tooltip>
                    </Show>
                  )}
                />
              </Show>
            </SplitHeaderRight>
            <SoupFiltersBar />
          </div>
          <Show when={hasLinkError()}>
            <EmailPermissionsBanner />
          </Show>
          <div
            class="relative grow min-h-1 flex max-sm:flex-col flex-row size-full"
            classList={{
              'pointer-events-none opacity-10': hasLinkError(),
            }}
          >
            <Suspense>
              <SoupViewFileDropzone>
                <SoupViewList
                  initialClientFilters={props.initialClientFilters}
                  skipPersistedState={props.skipPersistedState}
                />
              </SoupViewFileDropzone>
            </Suspense>
            <Show when={isMobile()}>
              <SoupViewMobileCreateButton activeView={activeListView} />
            </Show>
          </div>
          <Show when={isMobile()}>
            <MobileSoupViewTabs />
          </Show>
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
  initialClientFilters?: SetPredicatesInput<string>;
  skipPersistedState?: boolean;
}

export const SoupViewList = (props: SoupViewListProps) => {
  const panel = useSplitPanelOrThrow();
  const {
    soup,
    source,
    rows,
    searchText,
    setSearchText,
    queryFilters,
    featuredIds,
    isSearchServiceLoading,
    isLocalSearchSettling,
    activeTab,
    setActiveTab,
    assigneeFilter,
    setAssigneeFilter,
  } = useSoupView();
  const { hasActiveRefinements, resetToTabDefaults } = useFilterRefinements();

  const { isKeypressActive } = useIsKeyPressActive();

  const [virtualizerHandle, setVirtualizerHandle] =
    createSignal<VirtualizerHandle>();

  const [soupViewRef, setSoupViewRef] = createSignal<HTMLElement | undefined>();

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
  // There can be a case where the data may have arrived but the focusEffectsEnabled
  // and moveInitialFocus were not set correctly by the methods below. So
  // we need to also use them as deps for this effect. `initialLoad` should
  // handle not running after the initial load
  createEffect(
    on([rows, focusEffectsEnabled, moveInitialFocus], () => {
      if (!focusEffectsEnabled() || !moveInitialFocus()) return;
      if (!initialLoad || source.isLoading()) return;
      focusFirstEntity();
      initialLoad = false;
    })
  );

  // Focus first entity on filter/search changes
  createEffect(
    on(
      () => [soup.predicates.activeIds(), searchText(), featuredIds()] as const,
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

  // Register navigation hotkeys on the active list scope (usually the split
  // scope), but dispose them with the mounted SoupViewList. This keeps j/k
  // available while the list split is active without leaking into opened blocks
  // after the list unmounts.
  useSoupNavigationHotkeys({
    scopeId: scopeId(),
    soup,
    splitHandle: panel.handle,
    virtualizerHandle,
  });

  // Register entity action hotkeys
  useEntityActionHotkeys({
    scopeId: scopeId(),
    soup,
    activeSoupViewTab: activeTab,
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
    currentView,
    activeTab,
    applyTabPreset,
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

    // FIXME: this never gets called because we have overrides
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
  const contentId = panel.handle.content().id;

  // If another SoupViewList with the same contentId is already mounted (e.g.
  // same view open in two splits), disable all persistence for this instance
  const prevCount = activeSoupViewCounts.get(contentId) ?? 0;
  const isDuplicate = prevCount > 0;
  activeSoupViewCounts.set(contentId, prevCount + 1);
  onCleanup(() => {
    const count = activeSoupViewCounts.get(contentId) ?? 1;
    if (count <= 1) activeSoupViewCounts.delete(contentId);
    else activeSoupViewCounts.set(contentId, count - 1);
  });

  const persistenceDisabled = isProjectList || isDuplicate;

  const [persistedState, setPersistedState] = makePersisted(
    createSignal<PersistedSoupViewState>(),
    { name: soupViewCacheKey(contentId) }
  );

  const cacheKey = `soup-view-${panel.handle.id}-${contentId}${previewPanel ? '-preview' : ''}`;

  // Restore previewEntity synchronously so the first-render effect sees the
  // correct value and avoids a transient window where previewEntity is undefined.
  const initialPersistedState =
    !persistenceDisabled && !props.skipPersistedState
      ? untrack(persistedState)
      : null;
  soup.setPreviewEntity(initialPersistedState?.previewEntity);

  // Set initial state
  onMount(() => {
    if (initialPersistedState) {
      const isStale =
        (initialPersistedState.version ?? 0) < PERSISTED_STATE_VERSION;
      const applied =
        isStale &&
        isListViewID(contentId) &&
        initialPersistedState.activeTab &&
        applyTabPreset(contentId, initialPersistedState.activeTab);
      if (!applied) {
        batch(() => {
          soup.predicates.set(
            isStale
              ? (props.initialClientFilters ?? {})
              : initialPersistedState.filters
          );
          const persistedFilterData = isStale
            ? {}
            : (initialPersistedState.queryFilters ?? {});
          queryFilters.replace({
            include: persistedFilterData.include,
            exclude: persistedFilterData.exclude,
            emailView: persistedFilterData.emailView,
          });
          if (isListViewID(contentId)) {
            const tab =
              initialPersistedState.activeTab ??
              VIEW_TAB_PRESETS[contentId].default;
            if (tab) {
              setActiveTab(tab);
            }
          }
        });
      }
      batch(() => {
        soup.sort.setAll(initialPersistedState.sort ?? []);
        setAssigneeFilter(initialPersistedState.assigneeFilter ?? []);
        soup.grouping.setActiveGroupId(initialPersistedState.groupBy);
        soup.grouping.collapseAll(initialPersistedState.collapsedGroups ?? []);
      });
    } else {
      if (props.initialClientFilters) {
        soup.predicates.set(props.initialClientFilters);
      }
      // Set default tab for list views when no persisted state exists
      if (isListViewID(contentId)) {
        const defaultTab = VIEW_TAB_PRESETS[contentId].default;
        if (defaultTab) {
          setActiveTab(defaultTab);
        }
      }
    }
  });

  createEffect(
    on(
      () =>
        ({
          version: PERSISTED_STATE_VERSION,
          activeTab: activeTab(),
          filters: {
            and: [...soup.predicates.andIds()],
            or: [...soup.predicates.orIds()],
          },
          queryFilters: JSON.parse(JSON.stringify(queryFilters.state)),
          sort: soup.sort.active().map((s) => s.id),
          previewEntity: soup.previewEntity(),
          assigneeFilter: assigneeFilter(),
          groupBy: soup.grouping.activeGroupId(),
          collapsedGroups: [...soup.grouping.collapsedGroups()],
        }) satisfies PersistedSoupViewState,
      (state) => {
        if (!persistenceDisabled) setPersistedState(state);
      },
      { defer: true }
    )
  );

  onCleanup(() => {
    if (isProjectList) return;
    const virtualHandle = virtualizerHandle();
    listStateCache.set(cacheKey, {
      searchText: searchText(),
      focus: soup.focus.id(),
      virtualCache: virtualHandle?.cache,
      scrollOffset: virtualHandle?.scrollOffset,
    });
  });

  // Handles restoring scroll + focus.
  let restored = false;
  const restoreListState = () => {
    if (restored || isProjectList) return;
    restored = true;

    const cached = props.skipPersistedState
      ? undefined
      : listStateCache.get(cacheKey);
    if (cached) {
      setSearchText(cached.searchText);
      soup.focus.set(cached.focus);
      virtualizerHandle()?.scrollTo(cached.scrollOffset ?? 0);
      registerFocusEffects(false);
      return;
    }

    registerFocusEffects();
  };

  const registerVirtualizerHandler = (
    handle: VirtualizerHandle | undefined
  ) => {
    setVirtualizerHandle(handle);

    restoreListState();
  };

  const featuredCount = createMemo(() => featuredIds().length);

  const previewVisible = createMemo(
    () =>
      (!!soup.previewEntity() || panel.previewState[0]()) && !!soup.focus.item()
  );

  return (
    <MaybeSoupEntityActionDrawerManager>
      <div
        class="size-full no-select-children"
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
        <Resize.Zone direction="horizontal" gutter={0}>
          <Resize.Panel
            id="soup-list"
            minSize={200}
            maxSize={previewVisible() ? 840 : undefined}
          >
            <div
              class="@container/u-list size-full unified-list-root flex flex-col"
              classList={{
                'border-r border-edge-muted':
                  soup.previewEntity() !== undefined,
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
                    <div class="flex items-center gap-2 p-3 text-xs text-text-muted">
                      <Spinner class="size-3 animate-spin" />
                      Searching...
                    </div>
                  </Match>
                  <Match when={!rows().length}>
                    <EmptyState
                      listView={currentView()}
                      search={!!searchText()}
                      hasRefinementsFromBase={hasActiveRefinements()}
                      onClearFilters={resetToTabDefaults}
                    />
                  </Match>
                  <Match when={rows().length}>
                    <ListLayoutProvider ref={localEntityListRef}>
                      <Show when={currentView() === 'tasks' && !isMobile()}>
                        <ResponsiveTaskListHeader class="shrink-0" />
                      </Show>
                      <EntityRowProvider
                        container={localEntityListRef}
                        canSwipeLeft={(entityId) => {
                          const entity = entityById().get(entityId);
                          if (!entity) return false;

                          const tab = activeTab();

                          if (
                            !isListViewID(contentId) ||
                            (tab && !canExecuteMarkDoneOnView(contentId, tab))
                          )
                            return false;

                          return markDoneAction.canExecute(entity.original);
                        }}
                        onSwipeLeft={(entityId) => {
                          const entity = entityById().get(entityId);
                          if (!entity) return;
                          markDoneAction.executeWithSoup(
                            [entity.original],
                            soup
                          );
                        }}
                        setCollapseEntity={soup.collapseEntity.set}
                      >
                        <SoupList
                          cache={listStateCache.get(cacheKey)?.virtualCache}
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
                              if (row.original.sortTs)
                                return row.original.sortTs;

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
                                    i() === featuredCount() &&
                                    featuredCount() > 0
                                  }
                                >
                                  <div class="px-3 py-1.5 text-xs text-text-muted font-medium border-t border-edge-muted mt-1">
                                    More Results
                                  </div>
                                </Show>

                                <SoupEntityContextMenu entity={row.original}>
                                  <Dynamic
                                    component={
                                      currentView() === 'tasks'
                                        ? TaskListEntity
                                        : ListEntity
                                    }
                                    entity={row.original}
                                    timestamp={timestamp()}
                                    highlighted={
                                      panel.isPanelActive() && row.isFocused()
                                    }
                                    onMouseMove={() => {
                                      if (isKeypressActive()) return;
                                      if (soup.previewEntity()) return;
                                      soup.focus.set(row.id);
                                    }}
                                    showUnrollNotifications={
                                      soup.predicates.isActive('inbox') &&
                                      !soup.predicates.isActive('noise')
                                    }
                                    checked={row.isSelected()}
                                    onChecked={(next, shiftKey) =>
                                      handleMultiSelectChecked({
                                        entity: row.original,
                                        entityIndex: i(),
                                        next,
                                        shiftKey: shiftKey ?? false,
                                      })
                                    }
                                    onClick={(event) => {
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
                                    onContentHitClick={(e, location) => {
                                      onEntityClick({
                                        type: 'entity',
                                        entity: row.original,
                                        event: e,
                                        location,
                                      });
                                    }}
                                    entityRowConfig={{
                                      swipeLeftColor: 'bg-success',
                                      swipeLeftRevealedComponent: (
                                        <CheckIcon class="size-8 text-surface" />
                                      ),
                                    }}
                                  />
                                </SoupEntityContextMenu>
                                <Show
                                  when={
                                    i() === rows().length - 1 &&
                                    isSearchServiceLoading()
                                  }
                                >
                                  <div class="flex items-center gap-2 p-3 text-xs text-text-muted">
                                    <Spinner class="size-3 animate-spin" />
                                    Searching...
                                  </div>
                                </Show>
                                <Show when={i() === rows().length - 1}>
                                  <div class="h-15" />
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
          </Resize.Panel>
          <Show when={previewVisible()}>
            <Resize.Panel
              id="soup-preview"
              minSize={300}
              target={{ kind: 'percent', percent: 70 }}
            >
              <PreviewPanel
                selectedEntity={soup.focus.item()}
                orchestrator={orchestrator}
                splitPanelContext={panel}
                onFocusOut={() => {
                  soupViewRef()?.focus();
                }}
              />
            </Resize.Panel>
          </Show>
        </Resize.Zone>
        <Show when={soup.selection.count() > 0}>
          <SoupEntitySelectionToolbar
            selected={soup.selection.selected()}
            onClose={soup.selection.clear}
            onClear={soup.selection.clear}
          />
        </Show>
      </div>
    </MaybeSoupEntityActionDrawerManager>
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
      class={cn(
        'unified-table-body w-full flex-1 min-h-0 relative',
        props.class
      )}
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
