import { VIEW_TAB_PRESETS } from '@app/component/app-sidebar/soup-filter-presets';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { EntityRowProvider } from '@app/component/mobile/EntityRow';
import { FloatRegion } from '@app/component/mobile/float-regions/FloatRegion';
import {
  makeMarkDoneAction,
  useEntityActionHotkeys,
} from '@app/component/next-soup/actions';
import { canExecuteMarkDoneOnView } from '@app/component/next-soup/actions/make-mark-done-action';
import type {
  GroupHeaderProps,
  SoupRow,
} from '@app/component/next-soup/create-soup-state';
import { buildDocumentTypeQuery } from '@app/component/next-soup/filters/configs/document-type-query';
import type { Query } from '@app/component/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/component/next-soup/filters/filter-store/predicates-store';
import { useSoup } from '@app/component/next-soup/soup-context';
import { registerDocumentsFilterSplit } from '@app/component/next-soup/soup-view/documents-filter-controllers';
import { EmptyState } from '@app/component/next-soup/soup-view/empty-states';
import { InboxSelector } from '@app/component/next-soup/soup-view/filters-bar/inbox-selector';
import { SoupFiltersBar } from '@app/component/next-soup/soup-view/filters-bar/soup-filters-bar';
import { SoupSearchbar } from '@app/component/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { useFilterRefinements } from '@app/component/next-soup/soup-view/filters-bar/use-filter-refinements';
import { MaybeSoupEntityActionDrawerManager } from '@app/component/next-soup/soup-view/SoupEntityActionDrawerManager';
import { SoupEntityContextMenu } from '@app/component/next-soup/soup-view/soup-entity-context-menu';
import {
  persistSoupNavigationTouchHighlight,
  soupNavigationTouchHighlight,
} from '@app/component/next-soup/soup-view/soup-navigation-touch-highlight';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { SoupViewCreateButton } from '@app/component/next-soup/soup-view/soup-view-create-button';
import { SoupViewFileDropzone } from '@app/component/next-soup/soup-view/soup-view-file-dropzone';
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
import { CollapsibleHeaderItem } from '@app/component/split-layout/components/CollapsibleHeaderItem';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { SplitPanelContext } from '@app/component/split-layout/context';
import {
  useSplitPanel,
  useSplitPanelOrThrow,
} from '@app/component/split-layout/layoutUtils';
import { LIST_VIEW_DOCS_URL } from '@app/constants/docs-links';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { usePreference } from '@app/preferences/use-preference';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { Resize } from '@core/component/Resize';
import { UserIcon } from '@core/component/UserIcon';
import { ENABLE_UNIFIED_LIST_AI_INPUT } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import {
  soupListContainerAttribute,
  soupListContainerSelector,
} from '@core/dom-selectors';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { useDisplayName } from '@core/user/displayName';
import { type MacroId, tryMacroId } from '@core/user/macroId';
import { openExternalUrl } from '@core/util/url';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import {
  type EntityData,
  ListEntity,
  ListLayoutProvider,
  type ProjectEntity,
  type SearchLocation,
} from '@entity';
import SearchIcon from '@icon/macro-magnifying-glass.svg';
import { createEffectOnEntityTypeNotification } from '@notifications';
import CaretDownIcon from '@phosphor/caret-down.svg';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import CircleDashed from '@phosphor/circle-dashed.svg';
import InfoIcon from '@phosphor/info.svg';
import Spinner from '@phosphor/spinner.svg';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useQueryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import { invalidateEntityNotifications } from '@queries/notification/user-notifications';
import {
  invalidateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/normalized-cache';
import { debounce } from '@solid-primitives/scheduled';
import { Button, cn, Layer, Tooltip } from '@ui';
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
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import type { CacheSnapshot } from 'virtua/unstable_core';
import { SoupEntitySelectionToolbar } from './soup-entity-selection-toolbar';
import { useSoupNavigationHotkeys } from './use-soup-navigation-hotkeys';
import { useSoupViewHotkeys } from './use-soup-view-hotkeys';

export const SoupSectionHeader = (props: {
  children: JSX.Element;
  onClick?: () => void;
  highlighted?: boolean;
  class?: string;
}) => {
  return (
    <Layer depth={2}>
      <Dynamic
        component={props.onClick ? 'button' : 'div'}
        type={props.onClick ? 'button' : undefined}
        onClick={props.onClick}
        data-highlighted={props.highlighted || undefined}
        class={cn(
          'group/header relative w-[calc(100%-0.5rem)] mx-1 my-0.5 rounded-lg px-2 py-2 flex items-center gap-2.5 text-xs font-semibold tracking-tight',
          'text-text-muted bg-surface border border-edge-muted relative',
          props.onClick && 'hover:bg-active',
          props.class,
          props.highlighted && 'bg-active'
        )}
      >
        {props.children}
      </Dynamic>
    </Layer>
  );
};

const AssigneeGroupContent = (props: {
  assigneeId: MacroId;
  fallbackLabel: string;
}) => {
  const [assigneeName] = useDisplayName(props.assigneeId, {
    emailFallback: 'local-part',
  });
  return (
    <>
      <UserIcon
        id={props.assigneeId}
        size="sm"
        suppressClick
        showTooltip={false}
      />
      <span class="truncate">
        {assigneeName() || props.assigneeId || props.fallbackLabel}
      </span>
    </>
  );
};

const STATUS_GROUP_HEADER_TINTS: Record<string, string> = {
  [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED]:
    'bg-task/5 border-task/10 data-highlighted:bg-task/10 hover:bg-task/10',
  [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS]:
    'bg-alert/5 border-alert/10 data-highlighted:bg-alert/10 hover:bg-alert/10',
  [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW]:
    'bg-note/5 border-note/10 data-highlighted:bg-note/10 hover:bg-note/10',
  [PROPERTY_OPTION_IDS.STATUS.COMPLETED]:
    'bg-accent/5 border-accent/10 data-highlighted:bg-accent/10 hover:bg-accent/10',
  [PROPERTY_OPTION_IDS.STATUS.CANCELED]:
    'bg-ink/5 border-ink/10 data-highlighted:bg-ink/10 hover:bg-ink/10',
};

const DefaultGroupHeader = (
  props: GroupHeaderProps & { highlighted?: boolean }
) => {
  const { groupByField } = useSoupView();
  const assigneeId = createMemo(() => {
    const field = groupByField();
    if (
      field?.type !== 'property' ||
      field.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.ASSIGNEES ||
      props.group.key === ''
    ) {
      return;
    }
    return tryMacroId(props.group.key);
  });

  const statusTint = createMemo(() => {
    const field = groupByField();
    if (
      field?.type !== 'property' ||
      field.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.STATUS
    ) {
      return;
    }

    const optionId = props.group.value ?? props.group.key;
    if (typeof optionId !== 'string') return;

    return STATUS_GROUP_HEADER_TINTS[optionId];
  });

  return (
    <SoupSectionHeader
      onClick={() => props.group.toggle()}
      highlighted={props.highlighted}
      class={statusTint()}
    >
      <Layer depth={3}>
        <div class="flex items-center justify-center size-4.5 rounded-xs group-hover/header:bg-ink/5">
          <ChevronRightIcon
            class={cn('size-2.5', {
              'rotate-90': props.group.isExpanded(),
            })}
          />
        </div>
      </Layer>
      <Switch>
        <Match when={assigneeId()}>
          {(id) => (
            <AssigneeGroupContent
              assigneeId={id()}
              fallbackLabel={props.group.label}
            />
          )}
        </Match>
        <Match
          when={typeof props.group.value !== 'string' || !props.group.value}
        >
          <CircleDashed class="size-3.5 text-ink-extra-muted" />

          <span class="truncate">{props.group.label}</span>
        </Match>
        <Match
          when={typeof props.group.value === 'string' && props.group.value}
        >
          {(value) => (
            <>
              <PropertyValueIcon optionId={value()} class="size-3.5" />
              <span class="truncate">{props.group.label}</span>
            </>
          )}
        </Match>
      </Switch>
      <span
        class={cn(
          'shrink-0 tabular-nums text-xs font-medium',
          'px-1.5 py-px rounded-full bg-ink/10 text-ink-extra-muted'
        )}
      >
        {props.group.count}
      </span>
    </SoupSectionHeader>
  );
};

/**
 * Thin indeterminate progress bar shown at the top of the mobile soup list
 * while a new tab's query loads. Switching tabs keeps the previous tab's rows
 * on screen (placeholder data), so without this the user gets no feedback that
 * the new soup query is still in flight.
 */
const MobileTabLoadingBar = () => (
  <div class="pointer-events-none absolute inset-x-0 top-(--safe-top) z-10 h-0.5 overflow-hidden bg-accent/10">
    <div class="h-full w-2/5 rounded-full bg-accent animate-indeterminate-bar" />
  </div>
);

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

  createEffectOnEntityTypeNotification(
    notificationSource,
    'foreign_entity',
    (notification) => {
      refetchSoupEntity(notification.entity_id, 'foreignEntity');
      invalidateSoupEntity(notification.entity_id);
      invalidateEntityNotifications(notification.entity_id);
    }
  );
};

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
  initialFilters?: Query;
  initialSearchText?: string;
  /**
   * Initial group-by id (same format as `soup.grouping.setActiveGroupId`,
   * e.g. `property:<definition-id>`). Applied only when no persisted state
   * exists for this view.
   */
  initialGroupBy?: string;
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
  const soupView = useSoupView();

  const entryState = panel.handle.currentEntryState();
  const contentId = panel.handle.content().id;

  const persistedFilters = entryState?.['search.filters'] as Query | undefined;

  const persistedPredicates = entryState?.['search.predicates'] as
    | SetPredicatesInput<string>
    | undefined;

  const persistedSearchText = entryState?.['search.text'] as string | undefined;

  const persistedGroupBy = entryState?.['soup.groupBy'] as
    | string
    | null
    | undefined;

  const persistedActiveTab = entryState?.['soup.tab'] as string | undefined;

  const persistedCollapsedGroups = entryState?.['soup.collapsedGroups'] as
    | string[]
    | undefined;

  const [sortPref, setSortPref] = usePreference<string[]>(
    `macro:pref:soup:${contentId}:sort`,
    { default: [] }
  );

  // We handle the restore of the persistence here instead of within the context
  // because the context is no longer recreated for each soup view because we
  // moved it within the `SplitPanel`.
  //
  // We only restore the following because they either live as state in the
  // context or are used within the context to produce the output (like the
  // client filters, local search state, and additionalEntities)
  //
  // We use `createRenderEffect` to initialize before the elements mount
  let init = false;
  createRenderEffect(() => {
    if (init) return;
    init = true;
    batch(() => {
      soupView.initialize({
        initialQuery: persistedFilters ?? props.initialFilters,
        initialClientFilters: persistedPredicates ?? props.initialClientFilters,
        initialSearchText: persistedSearchText ?? props.initialSearchText,
        disableLocalSearch: props.disableLocalSearch,
        additionalEntities: props.additionalEntities,
      });

      const initialGroupBy = persistedGroupBy ?? props.initialGroupBy;

      let initialSortIds = sortPref();
      if (initialSortIds.length === 0) {
        initialSortIds = ['updated_at'];
      }

      let initialActiveTab = persistedActiveTab;

      if (initialActiveTab === undefined && isListViewID(contentId)) {
        initialActiveTab = VIEW_TAB_PRESETS[contentId].default;
      }

      soup.grouping.setActiveGroupId(initialGroupBy);
      soup.grouping.collapseAll(persistedCollapsedGroups ?? []);

      soup.sort.setAll(
        initialSortIds as Parameters<typeof soup.sort.setAll>[0]
      );

      soupView.setActiveTab(initialActiveTab);
    });
  });

  onMount(() => {
    if (contentId !== 'documents') return;

    const markdownQuery = buildDocumentTypeQuery(['doc-markdown']);
    if (!markdownQuery) return;

    const dispose = registerDocumentsFilterSplit(panel.handle.id, {
      toggleMarkdownFilter: () => {
        if (soup.predicates.isActive('doc-markdown')) {
          soupView.queryFilters.remove(markdownQuery);
          soup.predicates.set(({ andIds, orIds }) => ({
            and: andIds,
            or: orIds.filter((id) => id !== 'doc-markdown'),
          }));
          return;
        }

        soupView.queryFilters.add(markdownQuery);
        soup.predicates.set(({ andIds, orIds }) => ({
          and: andIds,
          or: [...new Set([...orIds, 'doc-markdown'])],
        }));
      },
    });

    onCleanup(dispose);
  });

  createEffect(() => {
    panel.handle.setDisplayName(props.viewName);
  });

  // Bridge live soup sort state back to preferences. `defer: true` skips the
  // initial run on mount, so we only write when the user actually changes it.
  createEffect(
    on(
      () => soup.sort.active().map((s) => s.id),
      (ids) => setSortPref(ids),
      { defer: true }
    )
  );

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

  const docsUrl = createMemo(() => {
    const view = activeListView();
    return view ? LIST_VIEW_DOCS_URL[view] : undefined;
  });

  const [narrowSearchExpanded, setNarrowSearchExpanded] = createSignal(false);
  const [mobileSearchOpen, setMobileSearchOpen] = createSignal(false);
  const [searchIsCollapsed, setSearchIsCollapsed] = createSignal(false);

  registerHotkey({
    hotkey: 'cmd+f',
    hotkeyToken: TOKENS.soup.openSearch,
    scopeId: panel.splitHotkeyScope,
    registrationType: 'add',
    description: 'Search',
    keyDownHandler: () => {
      if (isMobile()) {
        if (mobileSearchOpen()) return false;
        setMobileSearchOpen(true);
        return true;
      }
      if (narrowSearchExpanded() || !searchIsCollapsed()) return false;
      setNarrowSearchExpanded(true);
      return true;
    },
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
      <div class="size-full flex flex-col" data-list-view={activeListView()}>
        <div
          class={cn('flex flex-col w-full', {
            // In preview the separating border sits below this region, so it
            // ends up under the active-filters bar when shown, otherwise right
            // under the toolbar (the wrapper collapses to zero height).
            'border-b border-edge-muted': !isMobile() && !!soup.previewEntity(),
          })}
        >
          <SplitHeaderLeft>
            <div
              class={cn('h-full flex gap-3 items-center', {
                'shrink-0': !narrowSearchExpanded(),
                'flex-1 min-w-0': narrowSearchExpanded(),
              })}
            >
              <Show when={!isMobile() && !narrowSearchExpanded()}>
                <div class="flex items-center gap-1">
                  <span class="text-base font-bold">{props.viewName}</span>
                  <Show when={docsUrl()}>
                    {(url) => (
                      <Button
                        variant="ghost"
                        class="p-0.5 rounded-sm text-ink-extra-muted hover:text-ink-muted"
                        label="View documentation"
                        onClick={() => openExternalUrl(url())}
                      >
                        <InfoIcon class="size-3.5" />
                      </Button>
                    )}
                  </Show>
                </div>
              </Show>
              <Show
                when={!narrowSearchExpanded() && !isComponentListView('search')}
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
              </Show>
              <Show
                when={
                  !isMobile() &&
                  !narrowSearchExpanded() &&
                  isComponentListView('mail')
                }
              >
                <InboxSelector />
              </Show>
            </div>
          </SplitHeaderLeft>
          <Show when={!isMobile()}>
            <SplitHeaderRight>
              <Show
                when={!narrowSearchExpanded() && !isComponentListView('search')}
              >
                <SoupViewCreateButton />
              </Show>
              <Show when={narrowSearchExpanded()}>
                <Layer depth={2}>
                  <div class="flex-1 min-w-0">
                    <SoupSearchbar
                      variant="secondary"
                      autoFocus
                      initialValue={props.initialSearchText}
                      onDismiss={() => setNarrowSearchExpanded(false)}
                    />
                  </div>
                </Layer>
              </Show>
              <Show
                when={!isComponentListView('search')}
                fallback={
                  <Layer depth={2}>
                    <div class="grow ml-2 min-w-0 [contain:inline-size]">
                      <SoupSearchbar
                        variant="secondary"
                        placeholder="Search, @mention contacts"
                        initialValue={props.initialSearchText}
                      />
                    </div>
                  </Layer>
                }
              >
                <Show when={!narrowSearchExpanded()}>
                  <CollapsibleHeaderItem
                    id="search"
                    priority={0}
                    onCollapsedChange={(isCollapsed) => {
                      setSearchIsCollapsed(isCollapsed);
                      if (!isCollapsed) setNarrowSearchExpanded(false);
                    }}
                    expanded={() => (
                      <Layer depth={2}>
                        <div class="w-60 ml-2">
                          <SoupSearchbar
                            variant="secondary"
                            initialValue={props.initialSearchText}
                          />
                        </div>
                      </Layer>
                    )}
                    collapsed={() => (
                      <Tooltip label="Search" hotkey={TOKENS.soup.openSearch}>
                        <Button
                          variant="base"
                          class="p-1 size-7 rounded-lg ml-2 bg-surface"
                          onClick={() => setNarrowSearchExpanded(true)}
                          depth={2}
                        >
                          <SearchIcon class="size-4 touch:size-6" />
                        </Button>
                      </Tooltip>
                    )}
                  />
                </Show>
              </Show>
            </SplitHeaderRight>
          </Show>
        </div>
        <SoupFiltersBar />
        <div class="relative grow min-h-1 flex max-sm:flex-col flex-row size-full">
          <Suspense>
            <SoupViewFileDropzone>
              <SoupViewList />
            </SoupViewFileDropzone>
          </Suspense>
          <Show when={isMobile()}>
            <FloatRegion region="accessory">
              <MobileSoupViewTabs />
            </FloatRegion>
          </Show>
        </div>
      </div>
      <Suspense>
        <Show when={ENABLE_UNIFIED_LIST_AI_INPUT && !isMobile()}>
          <SoupChatInput />
        </Show>
      </Suspense>
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
    featuredIds,
    isSearchServiceLoading,
    isLocalSearchSettling,
    activeTab,
    fetchNextGroupPage,
    isFetchingGroupPage,
  } = useSoupView();
  const { hasActiveRefinements, hasHiddenItems, resetToTabDefaults } =
    useFilterRefinements();

  // Debug: force nav views to render their empty state regardless of content.
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  const { isKeypressActive } = useIsKeyPressActive();

  const [virtualizerHandle, setVirtualizerHandle] =
    createSignal<VirtualizerHandle>();

  const [soupViewRef, setSoupViewRef] = createSignal<HTMLElement | undefined>();

  const focusFirstEntity = () => {
    const allRows = rows();
    const firstEntityIndex = allRows.findIndex(
      (row) => !row.getIsGrouped() && !row.getIsLoadMore()
    );
    if (firstEntityIndex === -1) return;

    const result = soup.navigate.toIndex(firstEntityIndex);
    if (result) {
      virtualizerHandle()?.scrollToIndex(result.index, { align: 'nearest' });
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

  // Defer .focus() so the hotkey focusin handler's setActiveScope write doesn't re-invalidate this effect from inside its own tracking scope.
  createEffect(() => {
    if (previewPanel) return;

    const ref = soupViewRef();
    if (!ref) return;
    queueMicrotask(() => ref.focus());
  });

  const [attachHotkeys, soupViewScope] = useHotkeyDOMScope('soup-view');

  const scopeId = createMemo(() => {
    return previewPanel
      ? soupViewScope
      : (props.scopeId ?? panel.splitHotkeyScope);
  });

  // Register navigation hotkeys on the active list scope (usually the split
  // scope). Most handlers are disposed with SoupViewList, but j/k intentionally
  // remain on the split scope so an entity opened from the list can continue to
  // drive list navigation and update the split content.
  useSoupNavigationHotkeys({
    scopeId: scopeId(),
    soup,
    splitHandle: panel.handle,
    virtualizerHandle,
    hasNextPage: source.hasNextPage,
    isFetching: source.isFetching,
    isFetchingNextPage: source.isFetchingNextPage,
    fetchNextPage: source.fetchNextPage,
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
    fetchNextGroupPage,
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
    rowIndex?: number;
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
      if (args.rowIndex !== undefined) soup.focus.setIndex(args.rowIndex);
      else soup.focus.set(entity.id);
      return;
    }

    const finishTouchHighlight = persistSoupNavigationTouchHighlight(event);

    try {
      await openEntityInSplitFromUnifiedList(entity, {
        openInNewSplit: event.shiftKey,
        location,
        splitHandle: panel.handle,
        referredFrom: currentView(),
      });
    } finally {
      finishTouchHighlight?.();
    }
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

  const cacheKey = `soup-view-${panel.handle.id}-${contentId}${previewPanel ? '-preview' : ''}`;

  // Preview-pane open state is transient per history entry: captured into
  // per-entry state on nav-away and restored on back/forward. Read
  // synchronously in the body so the first render sees the correct value
  // and we avoid a transient flash where the pane is closed.
  const persistedPreview = panel.handle.currentEntryState()?.['soup.preview'] as
    | string
    | undefined;
  soup.setPreviewEntity(persistedPreview);
  const previewCaptorTeardown = panel.handle.registerEntryStateCaptor(
    'soup.preview',
    () => soup.previewEntity()
  );
  onCleanup(previewCaptorTeardown);

  // Which groups are collapsed is also per-entry state: captured on nav-away
  // and restored on back/forward.
  const collapsedCaptorTeardown = panel.handle.registerEntryStateCaptor(
    'soup.collapsedGroups',
    () => [...soup.grouping.collapsedGroups()]
  );
  onCleanup(collapsedCaptorTeardown);

  // Active grouping is per-entry state too, so back/forward restores the
  // grouping the user left each entry with. `null` (vs. key absent) records
  // an explicit "no grouping" choice, which would otherwise be
  // indistinguishable from a fresh entry.
  const groupByCaptorTeardown = panel.handle.registerEntryStateCaptor(
    'soup.groupBy',
    () => soup.grouping.activeGroupId() ?? null
  );
  onCleanup(groupByCaptorTeardown);

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

    const cached = listStateCache.get(cacheKey);
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

  createEffect(() => {
    const hasPreviewEntity = !!soup.previewEntity();
    const [getPreview, setPreview] = panel.previewState;
    if (hasPreviewEntity !== getPreview()) {
      setPreview(hasPreviewEntity);
    }
  });

  // The preview flag lives on the panel, so clear it when the soup view
  // unmounts (e.g. pressing enter replaces the split with the full entity);
  // otherwise it stays stale-true and the entity's toolbar keeps the border.
  onCleanup(() => panel.previewState[1](false));

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
              class={cn(
                '@container/u-list size-full unified-list-root flex flex-col relative',
                soup.previewEntity() !== undefined &&
                  'border-r border-edge-muted'
              )}
            >
              <Show when={isMobile() && source.isPlaceholderData()}>
                <MobileTabLoadingBar />
              </Show>
              <StaticMarkdownContext>
                <Switch>
                  <Match when={source.isFetching() && !rows().length}>
                    {/* Non-list states pad the chrome top themselves — the
                        panel leaves list views unpadded so rows can
                        under-scroll the status bar. */}
                    <div class="flex-1 min-h-0 flex flex-col mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)">
                      <LoadingBlock />
                    </div>
                  </Match>
                  <Match
                    when={
                      (isSearchServiceLoading() || isLocalSearchSettling()) &&
                      !rows().length
                    }
                  >
                    <div class="flex items-center gap-2 p-3 text-xs text-text-muted mobile:mt-(--mobile-content-inset-top) mobile:mb-(--mobile-content-inset-bottom)">
                      <Spinner class="size-3 animate-spin" />
                      Searching...
                    </div>
                  </Match>
                  <Match
                    when={
                      (!source.isFetching() && !rows().length) ||
                      forceEmptyState()
                    }
                  >
                    <div class="flex-1 min-h-0 flex flex-col mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)">
                      <EmptyState
                        listView={currentView()}
                        search={!!searchText()}
                        hasRefinementsFromBase={hasActiveRefinements()}
                        hasHiddenItems={hasHiddenItems()}
                        onClearFilters={resetToTabDefaults}
                      />
                    </div>
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
                          ref={(el) => {
                            setLocalEntityListRef(el);
                            soupNavigationTouchHighlight(el);
                          }}
                          virtualizerClass={cn(
                            previewVisible() && 'pt-1' /* scuffed */,
                            'scrollbar-hidden'
                          )}
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
                                  <SoupSectionHeader>
                                    <span class="truncate">
                                      Featured Results
                                    </span>
                                  </SoupSectionHeader>
                                </Show>
                                <Show
                                  when={
                                    i() === featuredCount() &&
                                    featuredCount() > 0
                                  }
                                >
                                  <SoupSectionHeader>
                                    <span class="truncate">More Results</span>
                                  </SoupSectionHeader>
                                </Show>

                                <Switch>
                                  {/* Group header row */}
                                  <Match when={row.getIsGrouped() && row.group}>
                                    {(group) => (
                                      <Dynamic
                                        component={
                                          group().renderHeader ??
                                          DefaultGroupHeader
                                        }
                                        group={group()}
                                        highlighted={row.isFocused()}
                                      />
                                    )}
                                  </Match>

                                  {/* Load more row */}
                                  <Match
                                    when={
                                      row.group?.isExpanded() &&
                                      row.getIsLoadMore() &&
                                      row.group
                                    }
                                  >
                                    {(group) => {
                                      const highlighted = () => row.isFocused();
                                      return (
                                        <div
                                          class={cn(
                                            'my-1 rounded min-h-9 flex items-center justify-center',
                                            highlighted()
                                              ? 'w-[calc(100%-0.5rem)] mx-1 bg-active/60'
                                              : 'mx-auto'
                                          )}
                                        >
                                          <Show
                                            when={
                                              !isFetchingGroupPage(group().key)
                                            }
                                            fallback={
                                              <Button
                                                variant="base"
                                                size="sm"
                                                depth={2}
                                                class={cn({
                                                  'bg-surface': !highlighted(),
                                                  'border-transparent':
                                                    highlighted(),
                                                })}
                                                disabled
                                              >
                                                <Spinner class="size-3 animate-spin" />
                                                Loading...
                                              </Button>
                                            }
                                          >
                                            <Button
                                              variant="base"
                                              size="sm"
                                              depth={2}
                                              class={cn({
                                                'bg-surface': !highlighted(),
                                                'border-transparent':
                                                  highlighted(),
                                              })}
                                              onClick={() => {
                                                fetchNextGroupPage(group().key);
                                              }}
                                            >
                                              <CaretDownIcon class="size-2.5" />
                                              Load More
                                            </Button>
                                          </Show>
                                        </div>
                                      );
                                    }}
                                  </Match>

                                  {/* Entity row */}
                                  <Match
                                    when={!row.group || row.group?.isExpanded()}
                                  >
                                    <SoupEntityContextMenu
                                      entity={row.original}
                                    >
                                      <Dynamic
                                        component={
                                          currentView() === 'tasks'
                                            ? TaskListEntity
                                            : ListEntity
                                        }
                                        entity={row.original}
                                        timestamp={timestamp()}
                                        highlighted={row.isFocused()}
                                        onMouseMove={() => {
                                          if (isKeypressActive()) return;
                                          if (soup.previewEntity()) return;
                                          soup.focus.setIndex(row.index);
                                        }}
                                        showUnrollNotifications={
                                          row.original.type !== 'email' &&
                                          soup.predicates.isActive('inbox') &&
                                          !soup.predicates.isActive('noise')
                                        }
                                        checked={row.isSelected()}
                                        onChecked={(
                                          next: boolean,
                                          shiftKey: boolean
                                        ) =>
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
                                            rowIndex: row.index,
                                          });
                                        }}
                                        onProjectClick={(
                                          projectEntity,
                                          event
                                        ) => {
                                          onEntityClick({
                                            type: 'project',
                                            projectEntity,
                                            entity: row.original,
                                            event,
                                            location: undefined,
                                            rowIndex: row.index,
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
                                            rowIndex: row.index,
                                          });
                                        }}
                                        entityRowConfig={{
                                          swipeLeftColor: 'bg-success',
                                          swipeLeftRevealedComponent: (
                                            <CheckIcon class="size-8 text-panel" />
                                          ),
                                        }}
                                      />
                                    </SoupEntityContextMenu>
                                  </Match>
                                </Switch>
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
                                  {/* Desktop-only: mobile clearance comes
                                      from the in-scroll trailing spacer. */}
                                  <div class="h-15 mobile:hidden" />
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
                            soupListContainerSelector
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
  ref?: (el: HTMLDivElement) => void;
  virtualizerRef?: (handle: VirtualizerHandle) => void;
  class?: string;
  virtualizerClass?: string;
  itemSize?: number;
  overscan?: number;
  children: (row: SoupRow, index: Accessor<number>) => JSX.Element;
  onScrollOffsetChange?: (offset: number) => void;
  onScrollBottom?: VoidFunction;
  scrollBottomOffset?: number;
  rows: SoupRow[];
  cache?: CacheSnapshot;
}

const SoupList = (props: SoupListProps) => {
  const [virtualizerHandle, setVirtualizerHandle] =
    createSignal<VirtualizerHandle>();
  const splitPanel = useSplitPanel();

  const itemSize = createMemo(() => props.itemSize ?? DEFAULT_ITEM_SIZE);
  const overscan = createMemo(() => props.overscan ?? DEFAULT_OVERSCAN);

  // Full-frame mobile: rows under-scroll the status bar; this in-scroll
  // spacer is their resting inset (safe-top — list views have no header).
  const topInset = () =>
    isMobile() ? (splitPanel?.contentOffsetTop() ?? 0) : 0;

  const handleScroll = (offset: number) => {
    const handle = virtualizerHandle();

    if (!handle) return;

    props.onScrollOffsetChange?.(offset);

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

    if (handle) props.virtualizerRef?.(handle);
  };

  return (
    <div
      ref={props.ref}
      class={cn(
        'unified-table-body w-full flex-1 min-h-0 relative',
        props.class
      )}
    >
      {/* Hand-rolled VList (scroller + Virtualizer) so the full-frame mobile
          insets can live inside the scroller: rows rest clear of the chrome
          but still slide beneath it. `startMargin` keeps virtua's scroll
          math correct for the leading spacer. */}
      <div
        class={cn('overscroll-none', props.virtualizerClass)}
        style={{
          display: 'block',
          'overflow-y': 'auto',
          contain: 'strict',
          width: '100%',
          height: '100%',
        }}
        {...soupListContainerAttribute}
      >
        <div aria-hidden style={{ height: `${topInset()}px` }} />
        <Virtualizer
          cache={props.cache}
          ref={registerVirtualizerHandler}
          startMargin={topInset()}
          data={props.rows}
          itemSize={itemSize()}
          bufferSize={overscan() * itemSize()}
          onScroll={handleScroll}
        >
          {(row, i) => props.children(row, i)}
        </Virtualizer>
        <Show when={isMobile()}>
          <div aria-hidden class="h-(--mobile-content-inset-bottom)" />
        </Show>
      </div>
    </div>
  );
};
