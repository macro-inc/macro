import { LIST_VIEW_DOCS_URL } from '@app/constants/docs-links';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { SoupChatInput } from '@app/features/chat/SoupChatInput';
import {
  makeMarkDoneAction,
  useEntityActionHotkeys,
} from '@app/features/next-soup/actions';
import { canExecuteMarkDoneOnView } from '@app/features/next-soup/actions/make-mark-done-action';
import type {
  GroupHeaderProps,
  SoupRow,
} from '@app/features/next-soup/create-soup-state';
import { buildDocumentTypeQuery } from '@app/features/next-soup/filters/configs/document-type-query';
import type { Query } from '@app/features/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import { VIEW_TAB_PRESETS } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { useSoup } from '@app/features/next-soup/soup-context';
import { registerDocumentsFilterSplit } from '@app/features/next-soup/soup-view/documents-filter-controllers';
import { EmptyState } from '@app/features/next-soup/soup-view/empty-states';
import { InboxSelector } from '@app/features/next-soup/soup-view/filters-bar/inbox-selector';
import { SoupFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-filters-bar';
import { SoupSearchbar } from '@app/features/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { MaybeSoupEntityActionDrawerManager } from '@app/features/next-soup/soup-view/SoupEntityActionDrawerManager';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SoupEntityContextMenu } from '@app/features/next-soup/soup-view/soup-entity-context-menu';
import {
  persistSoupNavigationTouchHighlight,
  soupNavigationTouchHighlight,
} from '@app/features/next-soup/soup-view/soup-navigation-touch-highlight';
import { SoupRowMetadataProvider } from '@app/features/next-soup/soup-view/soup-row-metadata-provider';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { SoupViewCreateButton } from '@app/features/next-soup/soup-view/soup-view-create-button';
import { SoupViewFileDropzone } from '@app/features/next-soup/soup-view/soup-view-file-dropzone';
import {
  CollapsedSoupViewTabs,
  MobileSoupViewTabs,
  SoupViewTabs,
  useApplyPreset,
} from '@app/features/next-soup/soup-view/soup-view-tabs';
import { useIsNewInboxEnabled } from '@app/features/next-soup/soup-view/use-is-new-inbox-enabled';
import { CompanyKanban } from '@app/features/next-soup/soup-view/views/companies/CompanyKanban';
import { CompanyListEntity } from '@app/features/next-soup/soup-view/views/companies/CompanyListEntity';
import { ResponsiveCompanyListHeader } from '@app/features/next-soup/soup-view/views/companies/CompanyListHeader';
import {
  CompanyDisplayMenu,
  CompanyViewsMenu,
} from '@app/features/next-soup/soup-view/views/companies/CompanyViewsMenu';
import { CrmDefaultViewLoader } from '@app/features/next-soup/soup-view/views/companies/CrmDefaultView';
import { DateGroupHeader } from '@app/features/next-soup/soup-view/views/inbox/date-group-header';
import { InboxListEntity } from '@app/features/next-soup/soup-view/views/inbox/InboxListEntity';
import { TaskListEntity } from '@app/features/next-soup/soup-view/views/tasks/TaskListEntity';
import { ResponsiveTaskListHeader } from '@app/features/next-soup/soup-view/views/tasks/TaskListHeader';
import { TaskGroupHeader } from '@app/features/next-soup/soup-view/views/tasks/task-group-header';
import {
  openEntityInNewTab,
  openEntityInSplitFromUnifiedList,
  preventDuplicatePreviewEntityOpen,
} from '@app/features/next-soup/utils';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { usePreference } from '@app/preferences/use-preference';
import { useDealStages } from '@companies/crm/deal-stages';
import { CrmStageIcon } from '@companies/crm/StageIcon';
import type { CrmViewConfig } from '@companies/crm/saved-views';
import { useCrmUnavailable } from '@companies/crm/team-crm-config';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { PullToRefresh } from '@components/app/mobile/PullToRefresh';
import { SwipableRowProvider } from '@components/app/mobile/SwipableRow';
import { CollapsibleHeaderItem } from '@components/app/split-layout/components/CollapsibleHeaderItem';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { ENABLE_UNIFIED_LIST_AI_INPUT } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import {
  soupListContainerAttribute,
  soupListContainerSelector,
} from '@core/dom-selectors';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { openExternalUrl } from '@core/util/url';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import {
  type EntityData,
  isNonMemberChannelEntity,
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
import InfoIcon from '@phosphor/info.svg';
import Spinner from '@phosphor/spinner.svg';
import { useQueryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import { invalidateEntityNotifications } from '@queries/notification/user-notifications';
import {
  invalidateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/normalized-cache';
import { createElementSize } from '@solid-primitives/resize-observer';
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
import { useSoupPreviewAvailability } from './use-soup-preview-availability';
import { useSoupViewHotkeys } from './use-soup-view-hotkeys';

export const DefaultGroupHeader = (
  props: GroupHeaderProps & { highlighted?: boolean }
) => {
  const panel = useSplitPanelOrThrow();
  const dealStages = useDealStages();

  // The Customers view groups by option ids from the team's deal-stage set
  // (or other custom select options) that the static PropertyValueIcon
  // table doesn't know — render those through CrmStageIcon instead.
  const isCompaniesView = () => {
    const content = panel.handle.content();
    return content.type === 'component' && content.id === 'companies';
  };

  // Index into the active stage set so header dots match kanban columns.
  const stageIndex = (optionId: string): number | undefined => {
    const index = dealStages
      .stages()
      .findIndex((stage) => stage.id === optionId);
    return index === -1 ? undefined : index;
  };

  const stageOptionId = () => {
    if (!isCompaniesView()) return undefined;
    const value = props.group.value ?? props.group.key;
    return typeof value === 'string' && value ? value : undefined;
  };

  return (
    <SoupSectionHeader
      onClick={() => props.group.toggle()}
      highlighted={props.highlighted}
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

      <Show when={stageOptionId()}>
        {(value) => (
          <CrmStageIcon
            optionId={value()}
            index={stageIndex(value())}
            class="size-3.5"
          />
        )}
      </Show>
      <span class="truncate">{props.group.label}</span>
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
      const meta = notification.notification_metadata;

      let threadId;

      if (
        meta.tag === 'channel_mention' ||
        meta.tag === 'channel_message_reply'
      ) {
        threadId = meta.content.threadId?.toString();
      }

      refetchSoupEntity(notification.entity_id, 'channel');
      invalidateSoupEntity(notification.entity_id);
      invalidateEntityNotifications(notification.entity_id);

      // For new inbox, we want to display channel threads so we should refetch the thread
      // item if this notification was for a thread
      if (threadId) {
        refetchSoupEntity(threadId, 'channelThread');
        invalidateSoupEntity(threadId);
        invalidateEntityNotifications(threadId);
      }
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

const SOUP_LIST_STATE_ENTRY_KEY = 'soup.listState';
type SoupListEntryState = {
  focus: string | undefined;
  virtualCache?: CacheSnapshot;
  scrollOffset?: number;
};

interface SoupViewProps {
  viewName: string;
  customTabs?: JSX.Element;
  filterBarVariant?: 'default' | 'tag';
  showCreateButton?: boolean;
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
  /**
   * Shared CRM view opened via a `?crmView=` link (Customers view only).
   * When set, its pieces win over persisted/preset state during init.
   */
  initialCrmView?: CrmViewConfig;
}

export const SoupView = (props: SoupViewProps) => {
  const soup = useSoup();
  const panel = useSplitPanelOrThrow();
  const soupView = useSoupView();
  const isNewInboxEnabled = useIsNewInboxEnabled();
  const hasPreviewItems = useSoupPreviewAvailability({
    rows: soupView.rows,
    isLoading: soupView.source.isLoading,
    isFetching: soupView.source.isFetching,
    isPlaceholderData: soupView.source.isPlaceholderData,
    splitHandle: panel.handle,
  });
  const openFocusedEntityInPreview = () => {
    const focusedRow = soup.focus.row();
    if (
      !focusedRow ||
      focusedRow.getIsGrouped() ||
      focusedRow.getIsLoadMore()
    ) {
      return;
    }
    void openEntityInSplitFromUnifiedList(focusedRow.original, {
      splitHandle: panel.handle,
    });
  };

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

  // Shared CRM view opened via a `?crmView=` link — only honored on the
  // Customers view; its pieces win over persisted/preset values in init.
  const initialCrmView =
    contentId === 'companies' ? props.initialCrmView : undefined;

  // A default saved view only applies to a fresh Customers entry: restored
  // (back/forward) entries keep what the user was looking at, and share
  // links carry their own state.
  const applyDefaultCrmView =
    contentId === 'companies' &&
    initialCrmView === undefined &&
    persistedFilters === undefined &&
    persistedPredicates === undefined;

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
        initialQuery: initialCrmView
          ? (initialCrmView.filters as Query | undefined)
          : (persistedFilters ?? props.initialFilters),
        initialClientFilters: initialCrmView
          ? (initialCrmView.clientFilters ?? {})
          : (persistedPredicates ?? props.initialClientFilters),
        initialSearchText: initialCrmView
          ? (initialCrmView.searchText ?? '')
          : (persistedSearchText ?? props.initialSearchText),
        preferInitialFilters: initialCrmView !== undefined,
        disableLocalSearch: props.disableLocalSearch,
        additionalEntities: props.additionalEntities,
      });

      // `groupBy: null` in a shared view records an explicit "no grouping",
      // which the grouping store expresses as `undefined`.
      const initialGroupBy = initialCrmView
        ? (initialCrmView.groupBy ?? undefined)
        : (persistedGroupBy ?? props.initialGroupBy);

      let initialSortIds = initialCrmView?.sort ?? sortPref();
      if (initialSortIds.length === 0) {
        initialSortIds = ['updated_at'];
      }

      const persistedViewActiveTab = isListViewID(contentId)
        ? soupView.getPersistedActiveTab(contentId)
        : undefined;
      let initialActiveTab =
        initialCrmView?.activeTab ??
        persistedActiveTab ??
        persistedViewActiveTab;

      if (initialActiveTab === undefined && isListViewID(contentId)) {
        initialActiveTab = VIEW_TAB_PRESETS[contentId].default;
      }

      soup.grouping.setActiveGroupId(initialGroupBy);
      soup.grouping.collapseAll(persistedCollapsedGroups ?? []);

      soup.sort.setAll(
        initialSortIds as Parameters<typeof soup.sort.setAll>[0]
      );

      soupView.setActiveTab(initialActiveTab);

      if (initialCrmView) {
        // Stage/owner sub-filters ride separate signals plus a client
        // predicate that must be active iff the selection is non-empty
        // (same rule as handleStageChange/handleOwnerChange in
        // unified-filter-dropdown).
        const stages = initialCrmView.stageFilter ?? [];
        soupView.setStageFilter(stages);
        if (stages.length > 0 !== soup.predicates.isActive('company-stage')) {
          soup.predicates.toggle({ and: ['company-stage'] });
        }
        const owners = initialCrmView.ownerFilter ?? [];
        soupView.setOwnerFilter(owners);
        if (owners.length > 0 !== soup.predicates.isActive('company-owner')) {
          soup.predicates.toggle({ and: ['company-owner'] });
        }
        soupView.setViewMode(initialCrmView.viewMode ?? 'board');
      }
    });
  });

  // A fresh Inbox starts in preview mode once its initial result settles, but
  // only when it has an entity to show. Resolve this once so manually exiting
  // preview mode is not undone by later Soup updates.
  let initialInboxPreviewResolved = false;
  createEffect(() => {
    if (initialInboxPreviewResolved || soupView.source.isLoading()) return;
    initialInboxPreviewResolved = true;
    if (contentId !== 'inbox') return;
    if (panel.handle.lastNavigationCause() !== 'fresh') return;
    if (panel.handle.isViewerSplit()) return;
    if (!hasPreviewItems()) return;
    panel.handle.engagePreview();
    if (panel.handle.isControllerSplit()) openFocusedEntityInPreview();
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

  const isBoardMode = createMemo(
    () => activeListView() === 'companies' && soupView.viewMode() === 'board'
  );

  // When CRM is unavailable (no team / disabled) the board renders the
  // empty state instead of columns, so board-only chrome tweaks (like
  // hiding the AI bar) shouldn't apply.
  const crmUnavailable = useCrmUnavailable();
  const isBoardRendered = createMemo(() => isBoardMode() && !crmUnavailable());

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
    <div class="size-full flex flex-col" data-list-view={activeListView()}>
      <div class="flex flex-col w-full">
        <SplitHeaderLeft>
          <div
            class={cn('h-full flex gap-3 items-center', {
              'shrink-0': !narrowSearchExpanded(),
              'flex-1 min-w-0': narrowSearchExpanded(),
            })}
          >
            <Show when={!isMobile() && !narrowSearchExpanded()}>
              <div class="flex items-center gap-1">
                <span class="text-sm font-semibold">{props.viewName}</span>
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
                  expanded={() => props.customTabs ?? <SoupViewTabs />}
                  collapsed={() =>
                    props.customTabs ?? <CollapsedSoupViewTabs />
                  }
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
              when={!narrowSearchExpanded() && isComponentListView('companies')}
            >
              <CompanyViewsMenu />
              <CompanyDisplayMenu />
            </Show>
            <Show
              when={
                !narrowSearchExpanded() &&
                !isComponentListView('search') &&
                props.showCreateButton !== false
              }
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
      <SoupFiltersBar
        variant={props.filterBarVariant}
        hasPreviewItems={hasPreviewItems()}
        onPreviewEngage={openFocusedEntityInPreview}
      />
      <Show when={applyDefaultCrmView}>
        <CrmDefaultViewLoader />
      </Show>
      <div class="relative grow min-h-1 flex max-sm:flex-col flex-row size-full">
        <Suspense>
          <Show when={!isBoardMode()} fallback={<CompanyKanban />}>
            <SoupViewList />
          </Show>
        </Suspense>
        <Show when={isMobile()}>
          <FloatRegion region="accessory">
            <MobileSoupViewTabs />
          </FloatRegion>
        </Show>
      </div>
      <Suspense>
        {/* The board hides the AI bar: it floats over the bottom edge, where
            it would cover the board's horizontal scrollbar. */}
        <Show
          when={
            ENABLE_UNIFIED_LIST_AI_INPUT &&
            !isMobile() &&
            !isNewInboxEnabled() &&
            !isBoardRendered()
          }
        >
          <SoupChatInput />
        </Show>
      </Suspense>
    </div>
  );
};

interface SoupViewListProps {
  customScrollbarHidden?: boolean;
  scopeId?: string;
}

/**
 * Complete soup-list composition boundary. Exported consumers receive the
 * shared metadata contexts required by every row and row-owned overlay.
 */
export const SoupViewList = (props: SoupViewListProps) => (
  <SoupRowMetadataProvider>
    <SoupViewListContent
      customScrollbarHidden={props.customScrollbarHidden}
      scopeId={props.scopeId}
    />
  </SoupRowMetadataProvider>
);

const SoupViewListContent = (props: SoupViewListProps) => {
  const panel = useSplitPanelOrThrow();
  const {
    soup,
    source,
    rows,
    searchText,
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

  const currentView = createMemo(() => {
    const { type, id } = panel.handle.content();
    if (type !== 'component') return;
    return isListViewID(id) ? id : undefined;
  });

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

      if (isNewInboxEnabled()) return;

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

        if (isNewInboxEnabled()) return;

        focusFirstEntity();
      },
      { defer: true }
    )
  );

  const registerFocusEffects = (shouldMoveInitialFocus = true) => {
    setMoveInitialFocus(shouldMoveInitialFocus);
    setFocusEffectsEnabled(true);
  };

  // Defer .focus() so the hotkey focusin handler's setActiveScope write doesn't re-invalidate this effect from inside its own tracking scope.
  createEffect(() => {
    const ref = soupViewRef();
    if (!ref) return;
    queueMicrotask(() => ref.focus());
  });

  const [attachHotkeys, soupViewScope] = useHotkeyDOMScope('soup-view');

  const scopeId = createMemo(() => props.scopeId ?? panel.splitHotkeyScope);

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

  const isNewInboxEnabled = useIsNewInboxEnabled();

  // The per-row component depends on the active view (and the inbox flag).
  const listEntityComponent = () => {
    if (currentView() === 'tasks') return TaskListEntity;
    if (currentView() === 'companies') return CompanyListEntity;
    if (isNewInboxEnabled()) return InboxListEntity;
    return ListEntity;
  };

  const groupHeaderComponent = () => {
    if (currentView() === 'tasks') return TaskGroupHeader;
    if (soup.grouping.activeGroupId() === 'date') return DateGroupHeader;
    return DefaultGroupHeader;
  };

  useSoupViewHotkeys({
    scopeId: scopeId(),
    soup,
    splitHandle: panel.handle,
    virtualizerHandle,
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
      // Channels the viewer hasn't joined can't be opened; the row's inline
      // Join button (or, in preview, the Viewer's Join prompt) is the only
      // affordance.
      if (!isNonMemberChannelEntity(entity)) {
        openEntityInNewTab({ entity, location });
      }
      return;
    }

    // Plain click while engaged as a Controller previews into the Viewer;
    // shift+click falls through to open a fresh split instead. Non-member
    // channels flow through to openEntityInSplitFromUnifiedList, which shows the
    // Viewer's Join prompt when previewing and otherwise no-ops.
    if (
      panel.handle.isControllerSplit() &&
      type === 'entity' &&
      !event.shiftKey
    ) {
      if (preventDuplicatePreviewEntityOpen(entity, panel.handle)) return;

      // Single click: focus the row AND open it in the Preview Pair's Viewer.
      // The openWithSplit redirect keeps the Viewer unfocused so keyboard
      // navigation stays in this list.
      if (args.rowIndex !== undefined) soup.focus.setIndex(args.rowIndex);
      else soup.focus.set(entity.id);

      await openEntityInSplitFromUnifiedList(entity, {
        location,
        splitHandle: panel.handle,
        referredFrom: currentView(),
      });
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

  // The virtualizer's scroll container, for mobile pull-to-refresh.
  const [listScrollerRef, setListScrollerRef] = createSignal<
    HTMLDivElement | undefined
  >();

  // The empty-state wrapper, so pull-to-refresh still works with no rows.
  const [emptyStateRef, setEmptyStateRef] = createSignal<
    HTMLDivElement | undefined
  >();

  // While a pull-driven refetch is in flight, the pull spinner is already
  // the loading indicator — the loading/searching blocks stay unmounted so
  // the empty state doesn't flash away (which would also unmount the
  // gesture's target element mid-refresh).
  const [isPullRefreshing, setIsPullRefreshing] = createSignal(false);

  const pullRefresh = () => {
    setIsPullRefreshing(true);
    return source.refresh().finally(() => setIsPullRefreshing(false));
  };

  // Shared by the empty-state <Match> and the pull-to-refresh target so the
  // gesture always attaches to whichever element is actually mounted.
  const showEmptyState = () =>
    ((!source.isFetching() || isPullRefreshing()) && !rows().length) ||
    forceEmptyState();

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

  const readListEntryState = () =>
    panel.handle.currentEntryState()?.[SOUP_LIST_STATE_ENTRY_KEY] as
      | SoupListEntryState
      | undefined;

  // Which groups are collapsed is per-entry state: captured on nav-away
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

  if (!isProjectList) {
    const listStateCaptorTeardown = panel.handle.registerEntryStateCaptor(
      SOUP_LIST_STATE_ENTRY_KEY,
      (): SoupListEntryState => {
        const virtualHandle = virtualizerHandle();
        return {
          focus: soup.focus.id(),
          virtualCache: virtualHandle?.cache,
          scrollOffset: virtualHandle?.scrollOffset,
        };
      }
    );
    onCleanup(listStateCaptorTeardown);
  }

  // Handles restoring scroll + focus.
  let restored = false;
  const restoreListState = (force = false) => {
    if (isProjectList) return;
    if (restored && !force) return;

    const cached = readListEntryState();
    if (cached) {
      soup.focus.set(cached.focus);
      const handle = virtualizerHandle();
      if (!handle) return;

      handle.scrollTo(cached.scrollOffset ?? 0);
      restored = true;
      registerFocusEffects(false);
      return;
    }

    if (force) return;

    restored = true;
    // The new inbox opens with a Preview Pair Viewer, so don't auto-focus (and
    // thus open) the first row on initial load.
    registerFocusEffects(!isNewInboxEnabled());
  };

  const registerVirtualizerHandler = (
    handle: VirtualizerHandle | undefined
  ) => {
    setVirtualizerHandle(handle);

    if (handle) restoreListState();
  };

  const featuredCount = createMemo(() => featuredIds().length);

  return (
    <MaybeSoupEntityActionDrawerManager>
      <div
        class="size-full"
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
        data-soup-view-id={panel.handle.id}
      >
        <SoupViewFileDropzone>
          <div class="@container/u-list size-full unified-list-root flex flex-col relative no-select-children">
            <Show when={isMobile() && source.isPlaceholderData()}>
              <MobileTabLoadingBar />
            </Show>
            <Show when={isMobile()}>
              <PullToRefresh
                scrollContainer={() =>
                  showEmptyState() ? emptyStateRef() : listScrollerRef()
                }
                onRefresh={pullRefresh}
              />
            </Show>
            <StaticMarkdownContext>
              <Switch>
                <Match
                  when={
                    source.isFetching() && !rows().length && !isPullRefreshing()
                  }
                >
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
                    !rows().length &&
                    !isPullRefreshing()
                  }
                >
                  <div class="flex items-center gap-2 p-3 text-xs text-text-muted mobile:mt-(--mobile-content-inset-top) mobile:mb-(--mobile-content-inset-bottom)">
                    <Spinner class="size-3 animate-spin" />
                    Searching...
                  </div>
                </Match>
                <Match when={showEmptyState()}>
                  <div
                    ref={setEmptyStateRef}
                    class="flex-1 min-h-0 flex flex-col mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)"
                  >
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
                    <Show when={currentView() === 'companies' && !isMobile()}>
                      <ResponsiveCompanyListHeader class="shrink-0" />
                    </Show>
                    <SwipableRowProvider
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
                        markDoneAction.executeWithSoup([entity.original], soup);
                      }}
                      setCollapseEntity={soup.collapseEntity.set}
                    >
                      <SoupList
                        cache={readListEntryState()?.virtualCache}
                        ref={(el) => {
                          setLocalEntityListRef(el);
                          soupNavigationTouchHighlight(el);
                        }}
                        scrollerRef={setListScrollerRef}
                        virtualizerClass={'scrollbar-hidden space-y-2'}
                        class="overflow-hidden flex min-w-0"
                        virtualizerRef={registerVirtualizerHandler}
                        onScrollBottom={debouncedFetchMore}
                        scrollBottomOffset={300}
                        rows={rows()}
                      >
                        {(row, i) => {
                          const timestamp = () => {
                            if (row.original.sortTs) return row.original.sortTs;

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
                                  <span class="truncate">Featured Results</span>
                                </SoupSectionHeader>
                              </Show>
                              <Show
                                when={
                                  i() === featuredCount() && featuredCount() > 0
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
                                        groupHeaderComponent()
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
                                  <SoupEntityContextMenu entity={row.original}>
                                    <Dynamic
                                      component={listEntityComponent()}
                                      entity={row.original}
                                      timestamp={timestamp()}
                                      highlighted={row.isFocused()}
                                      onMouseMove={() => {
                                        if (isKeypressActive()) return;
                                        if (panel.handle.isControllerSplit())
                                          return;
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
                                  (isSearchServiceLoading() ||
                                    source.isFetchingNextPage())
                                }
                              >
                                <div class="flex items-center gap-2 p-3 text-xs text-text-muted">
                                  <Spinner class="size-3 animate-spin" />
                                  {source.isFetchingNextPage()
                                    ? 'Loading more...'
                                    : 'Searching...'}
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
                    </SwipableRowProvider>
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
        </SoupViewFileDropzone>
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

const DEFAULT_OVERSCAN = 5;
const DEFAULT_ITEM_SIZE_ESTIMATE = 40;

interface SoupListProps {
  ref?: (el: HTMLDivElement) => void;
  /** Receives the inner scroll container (the element that owns scrollTop). */
  scrollerRef?: (el: HTMLDivElement) => void;
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

  const overscan = createMemo(() => props.overscan ?? DEFAULT_OVERSCAN);
  const [topSpacerRef, setTopSpacerRef] = createSignal<HTMLDivElement>();
  const topSpacerSize = createElementSize(topSpacerRef);

  // Full-frame mobile: rows under-scroll the status bar; this in-scroll
  // spacer is their resting inset (safe-top — list views have no header).
  const topInset = () => (isMobile() ? (topSpacerSize.height ?? 0) : 0);

  const handleScroll = (offset: number) => {
    const handle = virtualizerHandle();

    if (!handle) return;

    props.onScrollOffsetChange?.(offset);

    // Trigger within a viewport of the bottom so the next page is usually
    // loaded before the user reaches the end. scrollBottomOffset is a floor
    // for tiny viewports.
    const threshold = Math.max(
      props.scrollBottomOffset ?? 100,
      handle.viewportSize
    );

    if (handle.scrollSize - handle.viewportSize - offset <= threshold) {
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
        ref={props.scrollerRef}
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
        <div
          ref={setTopSpacerRef}
          aria-hidden
          class="h-0 block sm:hidden mobile:h-(--mobile-content-inset-top)"
        />
        <Virtualizer
          cache={props.cache}
          ref={registerVirtualizerHandler}
          startMargin={topInset()}
          data={props.rows}
          // Leave itemSize unset for heterogeneous lists so Virtua measures
          // larger rows; 40px is only the default overscan estimate.
          itemSize={props.itemSize}
          bufferSize={
            overscan() * (props.itemSize ?? DEFAULT_ITEM_SIZE_ESTIMATE)
          }
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
