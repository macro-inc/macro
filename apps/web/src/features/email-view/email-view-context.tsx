import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import {
  createListController,
  type ListActivation,
  type ListController,
  listOwnedSlotName,
} from '@app/components/list';
import { setSidebarSectionCollapsed } from '@app/components/view-shell';
import { composeDraftSearch } from '@app/features/email-compose/compose-route-draft';
import type {
  SavedViewSource,
  SavedViewsSource,
} from '@app/features/saved-views/context/saved-views-source';
import {
  createTagFacetContext,
  normalizeFacetSelection,
} from '@app/features/soup';
import { registerListNavigationSource } from '@app/features/soup/collection/list-navigation-source';
import { makePersistedState } from '@app/lib/persistence';
import {
  createSearchParams,
  useMatches,
  useNavigate,
  useRouteParams,
} from '@app/lib/split-router';
import { beginInteraction } from '@app/observability/flow';
import { usePreference } from '@app/preferences/use-preference';
import {
  emailComposeRoute,
  emailSplitRoute,
  emailThreadRoute,
} from '@app/routes/routes';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { markRowNotificationsSeenOnOpen } from '@notifications/mark-row-seen';
import { listTagOptions } from '@property/tags/list-tag-options';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import { useEmailLinksQuery } from '@queries/email/link';
import type { ContextProviderProps } from '@solid-primitives/context';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  createStore,
  produce,
  reconcile,
  type SetStoreFunction,
  type Store,
} from 'solid-js/store';
import { DEFAULT_EMAIL_FOCUS_SORT, DEFAULT_EMAIL_TAB } from './constants';
import {
  emailDetailSearch,
  emailTabSearch,
  emailTabSearchCodec,
} from './email-route';
import {
  type EmailFilterState,
  emailFilterStatesEqual,
  emailTabFilterState,
  emailTabRefinements,
  type MaterializedEmailSavedView,
  resolveEmailSavedViewScope,
  restoreEmailTabFilters,
} from './filters/email-saved-view';
import { normalizeInboxSelection } from './inbox-selection';
import { createEmailViewPersistence } from './persistence';
import {
  createEmailSavedViewDraft,
  type EmailSavedViewDraft,
} from './primitives/create-email-saved-view-draft';
import { createInboxSelectionReconciliation } from './primitives/inbox-selection-reconciliation';
import {
  type EmailDataSource,
  type EmailDataSourceInput,
  type EmailDataSourceItem,
  useEmailDataSource,
} from './queries/use-email-query';
import { useEmailTabAvailability } from './tab-availability';
import type {
  EmailFocusSort,
  EmailTab,
  EmailThreadTarget,
  EmailViewState,
  EmailViewStateOptions,
} from './types';

type EmailViewProviderProps = ContextProviderProps & {
  initialState?: EmailViewStateOptions;
  /** Saved-view sources; absent where the host has no saved views. */
  savedViewsEnabled?: Accessor<boolean>;
  savedViewsSource?: () => SavedViewsSource;
  savedViewSource?: (id: Accessor<string | undefined>) => SavedViewSource;
};

/** Identifies one saved-view request: account, view, and navigation. */
export type EmailSavedViewScopeKey = {
  id: string | undefined;
  viewerId: string | undefined;
  navigation: object;
};

export type EmailListActivationMetadata = {
  event?: MouseEvent;
  newSplit?: boolean;
};

type EmailListController = ListController<
  EmailDataSourceItem,
  EmailListActivationMetadata
>;

export type EmailViewContext = {
  state: Store<EmailViewState>;
  setState: SetStoreFunction<EmailViewState>;
  setTab: (tab: EmailTab) => void;
  setInboxIds: (ids: string[] | undefined) => void;
  setAliasFilter: (alias: NonNullable<EmailViewState['aliasFilter']>) => void;
  setFacets: (facets: EmailViewState['facets']) => void;
  /** Replaces any of the list's filters: facets, conditions, or inboxes. */
  setFilters: (filters: Partial<EmailListFilters>) => void;
  /** What Clear returns to: the tab's own filters, or none in a view. */
  filterBaseline: Accessor<EmailFilterState>;
  /** Whether facets or conditions differ from what Clear returns to. */
  filtersChanged: Accessor<boolean>;
  clearFilters: () => void;
  setFocusSort: (sort: EmailFocusSort) => void;
  /**
   * Filters by a single tag without changing tabs. Used by the inline
   * "filter by tag" button on entity rows.
   */
  filterByTag: (optionId: string) => void;
  /** The selected tags' names on All, where they alone scope the list. */
  tagViewTitle: Accessor<string | undefined>;
  source: EmailDataSource;
  list: EmailListController;
  registerListActivationHandler: (
    handler: (
      activation: ListActivation<
        EmailDataSourceItem,
        EmailListActivationMetadata
      >
    ) => void
  ) => void;
  selectedThread: Accessor<EmailThreadTarget | undefined>;
  /** A new email is open in the view (desktop). */
  composing: Accessor<boolean>;
  /** Returns false when inline detail is unavailable so the caller opens a split instead. */
  openThread: (
    thread: EmailThreadTarget,
    options?: EntityDetailNavigationOptions & {
      /** Replace the history entry, for opens that follow the list cursor. */
      replace?: boolean;
    }
  ) => boolean;
  closeThread: () => void;
  isSidebarSectionOpen: (id: string) => boolean;
  setSidebarSectionOpen: (id: string, open: boolean) => void;
  /** Open threads beside the list instead of in its place (desktop). */
  readingPane: Accessor<boolean>;
  setReadingPane: (enabled: boolean) => void;
  /** Whether saved views show at all; their sources may still be mounted. */
  savedViewsEnabled: Accessor<boolean>;
  /** Present only where the host mounts saved views. */
  savedViews?: EmailSavedViewDraft;
  savedViewsList?: SavedViewsSource;
  savedViewSource?: SavedViewSource;
  /** Whether a saved view, rather than a built-in tab, is open. */
  savedViewActive: Accessor<boolean>;
  /** The current request scope; stale completions compare against it. */
  savedViewScope: Accessor<EmailSavedViewScopeKey | undefined>;
  selectSavedView: (id: string) => void;
  leaveSavedView: () => void;
  /** Linked inboxes a view can be scoped to. */
  inboxOptions: Accessor<readonly { id: string; label: string }[]>;
};

/** Everything the Filters menu edits; aliases stay with the inbox picker. */
export type EmailListFilters = EmailFilterState &
  Pick<EmailViewState, 'inboxIds'>;

export const [EmailViewProvider, useEmailView] = createAssertedContextProvider<
  EmailViewContext,
  EmailViewProviderProps
>('EmailView', (props) => {
  const panel = useSplitPanelOrThrow();
  const navigate = useNavigate();
  const routeParams = useRouteParams(emailThreadRoute);
  const matches = useMatches();
  const [tabSearch] = createSearchParams(emailTabSearch);
  const selectPreview = createPreviewSelectionGuard();
  const userId = useUserId();
  const tagSets = useTagSets();
  const tagSetsReady = useTagSetsReady();
  const initial = props.initialState ?? {};
  const tabAvailability = useEmailTabAvailability();
  // A flag-gated tab stays put while its flags load, then falls back if off.
  const isTabOff = (tab: EmailTab) => tabAvailability(tab) === 'off';
  const availableTab = (tab: EmailTab) =>
    isTabOff(tab) ? DEFAULT_EMAIL_TAB : tab;

  const initialTab = availableTab(initial.tab ?? DEFAULT_EMAIL_TAB);
  const [persistedState, setState] = makePersistedState(
    createStore<EmailViewState>({
      tab: initialTab,
      search: initial.search ?? '',
      inboxIds: initial.aliasFilter
        ? [initial.aliasFilter.inboxId]
        : normalizeInboxSelection(initial.inboxIds),
      ...(initial.aliasFilter ? { aliasFilter: initial.aliasFilter } : {}),
      ...restoreEmailTabFilters(
        initialTab,
        initial.facets ?? {},
        initial.conditions
      ),
      focusSort: initial.focusSort ?? DEFAULT_EMAIL_FOCUS_SORT,
      collapsedSidebarSectionIds: [
        ...(initial.collapsedSidebarSectionIds ?? []),
      ],
    }),
    createEmailViewPersistence({
      handle: panel.handle,
      userId,
      restoreEntryState: props.initialState === undefined,
      restoreLocalState: props.initialState === undefined,
      restorePreferences: initial.collapsedSidebarSectionIds === undefined,
    })
  );
  const state = persistedState;

  // Saved views: the URL names the open view; its definition fills the All tab.
  const savedViewsEnabled = () =>
    Boolean(props.savedViewSource && props.savedViewsEnabled?.());
  const selectedSavedViewId = () =>
    savedViewsEnabled() ? tabSearch.savedView : undefined;
  const savedViewsList = props.savedViewsSource?.();
  const savedViewSource = props.savedViewSource?.(selectedSavedViewId);
  const savedViewActive = () => Boolean(selectedSavedViewId());
  const [savedViewNavigation, setSavedViewNavigation] = createSignal({});
  let savedViews: EmailSavedViewDraft | undefined;
  const facetContext = () => {
    const tags = new Map(
      createTagFacetContext(tagSets()).tagPropertyDefinitionByOptionId
    );
    for (const [option, property] of savedViews?.tagBindings() ?? [])
      tags.set(option, property);
    return { tagPropertyDefinitionByOptionId: tags };
  };
  const rememberBeforeSavedView = (draft: EmailViewState) => {
    draft.beforeSavedView ??= {
      tab: draft.tab,
      inboxIds: draft.inboxIds && [...draft.inboxIds],
      aliasFilter: draft.aliasFilter && { ...draft.aliasFilter },
    };
  };
  const applySavedView = (restored: MaterializedEmailSavedView) =>
    setState(
      produce((draft) => {
        rememberBeforeSavedView(draft);
        draft.tab = 'all';
        draft.inboxIds = restored.inboxIds;
        draft.aliasFilter = undefined;
        draft.facets = normalizeFacetSelection(restored.facets);
        draft.conditions = restored.conditions;
      })
    );
  /** Returns to the tab and inboxes from before the view, or to `tab`. */
  const clearSavedViewState = (tab?: EmailTab) =>
    setState(
      produce((draft) => {
        const before = draft.beforeSavedView;
        draft.tab = availableTab(tab ?? before?.tab ?? DEFAULT_EMAIL_TAB);
        if (before) {
          draft.inboxIds = before.inboxIds;
          draft.aliasFilter = before.aliasFilter;
        }
        Object.assign(draft, emailTabFilterState(draft.tab));
        draft.search = '';
        draft.beforeSavedView = undefined;
      })
    );
  if (savedViewSource) {
    savedViews = createEmailSavedViewDraft({
      source: savedViewSource,
      selectedId: selectedSavedViewId,
      viewerId: userId,
      state,
      facetContext,
      apply: applySavedView,
    });
  }
  const savedViewScope = createMemo(() => ({
    id: selectedSavedViewId(),
    viewerId: userId(),
    navigation: savedViewNavigation(),
  }));
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  // Runs before the tab effect below, so arriving at a view through a link or
  // history keeps the tab it came from and stays on All.
  createEffect(
    on(
      () => [selectedSavedViewId(), userId()] as const,
      ([id, viewer], previous) => {
        if (!savedViewSource) return;
        const [previousId, previousViewer] = previous ?? [];
        const accountChanged =
          previousViewer !== undefined && viewer !== previousViewer;
        if (id && !accountChanged) {
          if (id !== previousId)
            setState(
              produce((draft) => {
                rememberBeforeSavedView(draft);
                draft.tab = 'all';
                draft.search = '';
              })
            );
          return;
        }
        if (state.beforeSavedView) clearSavedViewState();
        // Another account's view is not this one's: leave its URL too.
        if (id && accountChanged) navigateToList(undefined);
      }
    )
  );

  createEffect(
    on(
      () => availableTab(tabSearch.tab),
      (tab) => {
        if (state.tab === tab) return;
        setState(
          produce((draft) => {
            if (draft.tab === 'reminders' || tab === 'reminders')
              draft.search = '';
            draft.tab = tab;
            Object.assign(draft, emailTabFilterState(tab));
          })
        );
      }
    )
  );

  createEffect(() => {
    if (isTabOff(state.tab)) {
      setState({
        tab: DEFAULT_EMAIL_TAB,
        search: '',
        ...emailTabFilterState(DEFAULT_EMAIL_TAB),
      });
    }
  });

  // This belongs to the view lifecycle, even while every inbox picker is unmounted.
  const linksQuery = useEmailLinksQuery();
  // A tab whose own restrictions still stand keeps its query; once they or a
  // condition change, the filters list mail as an open view's would.
  const listFilters = createMemo(() => {
    const refinements = savedViewActive()
      ? undefined
      : emailTabRefinements(state.tab, state);
    if (refinements) return { tab: state.tab, facets: refinements };
    const conditions = state.conditions;
    return {
      tab: 'all' as const,
      facets: state.facets,
      scope: conditions && resolveEmailSavedViewScope(conditions, new Date()),
    };
  });
  const listInput: EmailDataSourceInput = {
    get tab() {
      return listFilters().tab;
    },
    get facets() {
      return listFilters().facets;
    },
    get search() {
      return state.search;
    },
    get inboxIds() {
      return state.inboxIds;
    },
    get aliasFilter() {
      return state.aliasFilter;
    },
    get focusSort() {
      return state.focusSort;
    },
  };
  // A view never lists mail before its definition has loaded: that would
  // show all mail under the view's name.
  const savedViewQueryReady = () =>
    !savedViewActive() ||
    (savedViews?.view().kind === 'saved' && !!state.conditions);

  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () =>
    useEmailDataSource(listInput, {
      tagSets,
      tagSetsReady,
      tagBindings: () => savedViews?.tagBindings(),
      savedView: () => {
        const filters = listFilters();
        return 'scope' in filters ? filters.scope : undefined;
      },
      enabled: savedViewQueryReady,
    })
  );
  withSplitPanelOwner(listOwnedSlotName('navigation-source'), () =>
    registerListNavigationSource(panel.handle, {
      viewId: 'mail',
      entities: () =>
        source
          .items()
          .flatMap((row) => (row.kind === 'entity' ? [row.entity] : [])),
      hasMore: source.hasMore,
      loadMore: async () => {
        await source.loadMore();
        const error = source.error();
        if (error) throw error;
      },
    })
  );
  let listActivationHandler:
    | ((
        activation: ListActivation<
          EmailDataSourceItem,
          EmailListActivationMetadata
        >
      ) => void)
    | undefined;
  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<EmailDataSourceItem, EmailListActivationMetadata>({
      items: source.items,
      getKey: (row) => row.id,
      selection: {
        getKey: (row) => (row.kind === 'entity' ? row.entity.id : row.id),
      },
      isNavigable: (row) => row.kind === 'entity' || row.kind === 'load-more',
      isSelectable: (row) => row.kind === 'entity',
      onActivate: (activation) => listActivationHandler?.(activation),
    })
  );
  const registerListActivationHandler = (
    handler: NonNullable<typeof listActivationHandler>
  ) => {
    listActivationHandler = handler;
    onCleanup(() => {
      if (listActivationHandler === handler) listActivationHandler = undefined;
    });
  };

  const selectedThread = createMemo<EmailThreadTarget | undefined>(() => {
    const threadId = routeParams.threadId;
    return typeof threadId === 'string' ? { id: threadId } : undefined;
  });

  const composing = () =>
    matches().some((match) => match.id === emailComposeRoute.id);

  const opensInline = (options?: EntityDetailNavigationOptions) => {
    const event = options?.event;
    return (
      !isTouchDevice() &&
      !(event?.shiftKey || event?.metaKey || event?.ctrlKey || event?.altKey)
    );
  };
  const navigateToList = (savedView: string | undefined) => {
    fireAndForget(
      navigate(
        { route: emailSplitRoute, params: {} },
        {
          search: {
            // A new email's draft stays with its own entry.
            [composeDraftSearch.namespace]: {},
            [emailTabSearch.namespace]: emailTabSearchCodec.serialize({
              tab: state.tab,
              savedView,
            }),
          },
        }
      ),
      'email-view'
    );
  };
  const closeThread = () => navigateToList(tabSearch.savedView);
  const notificationSource = useGlobalNotificationSource();
  const openThread = (
    thread: EmailThreadTarget,
    options?: EntityDetailNavigationOptions & { replace?: boolean }
  ) => {
    if (!opensInline(options)) return false;
    const selection = { type: 'email' as const, id: thread.id };
    // The router may refuse a claimed destination. Check compatibility without
    // claiming it until the accepted route changes.
    if (!selectPreview.canSelect(selection)) return true;
    const row = source
      .items()
      .find((row) => row.kind === 'entity' && row.entity.id === thread.id);
    if (row?.kind === 'entity')
      markRowNotificationsSeenOnOpen(row.entity, notificationSource);
    fireAndForget(
      navigate(
        { route: emailThreadRoute, params: { threadId: thread.id } },
        {
          replace: options?.replace,
          search: {
            [composeDraftSearch.namespace]: {},
            [emailDetailSearch.namespace]: {},
            [emailTabSearch.namespace]: emailTabSearchCodec.serialize({
              tab: state.tab,
              savedView: tabSearch.savedView,
            }),
          },
        }
      ),
      'email-view'
    );
    return true;
  };

  createEffect(
    on(selectedThread, (thread, previous) => {
      const selection = thread
        ? { type: 'email' as const, id: thread.id }
        : undefined;
      if (!selectPreview(selection)) {
        if (previous) {
          fireAndForget(
            navigate(
              {
                route: emailThreadRoute,
                params: { threadId: previous.id },
              },
              {
                replace: true,
                search: {
                  [emailTabSearch.namespace]: emailTabSearchCodec.serialize({
                    tab: state.tab,
                    savedView: tabSearch.savedView,
                  }),
                },
              }
            ),
            'email-view'
          );
        } else {
          fireAndForget(
            navigate(
              { route: emailSplitRoute, params: {} },
              {
                replace: true,
                search: {
                  [emailTabSearch.namespace]: emailTabSearchCodec.serialize({
                    tab: state.tab,
                    savedView: tabSearch.savedView,
                  }),
                },
              }
            ),
            'email-view'
          );
        }
        return;
      }
      if (!thread) return;
      const row = source
        .items()
        .find((item) => item.kind === 'entity' && item.entity.id === thread.id);
      if (!row) return;
      list.focus.set(row.id, { reason: 'programmatic', force: true });
      list.selection.setAnchor(row.id);
    })
  );

  // A tab is a fresh slice of the mailbox: filters chosen for one tab (Done
  // on Signal, say) would silently narrow the next, so they reset with it.
  const setTab = (requestedTab: EmailTab) => {
    const tab = availableTab(requestedTab);
    if (savedViewActive()) {
      batch(() => {
        setSavedViewNavigation({});
        clearSavedViewState(tab);
        navigateToList(undefined);
      });
      return;
    }
    if (state.tab === tab) {
      closeThread();
      return;
    }
    // The list's email.list flow restarts for the tab and joins this.
    const interaction = beginInteraction('email.tab', {
      attributes: { 'email.tab': tab },
      closeOnJoin: true,
    });
    try {
      setState(
        produce((draft) => {
          if (draft.tab === 'reminders' || tab === 'reminders')
            draft.search = '';
          draft.tab = tab;
          Object.assign(draft, emailTabFilterState(tab));
        })
      );
      closeThread();
    } finally {
      interaction.end();
    }
  };

  // Opening a view replaces the current filters; its definition fills them in.
  const selectSavedView = (id: string) => {
    if (!savedViewSource) return;
    batch(() => {
      setSavedViewNavigation({});
      setState(
        produce((draft) => {
          rememberBeforeSavedView(draft);
          draft.tab = 'all';
          draft.search = '';
        })
      );
      navigateToList(id);
    });
  };
  const leaveSavedView = () =>
    batch(() => {
      setSavedViewNavigation({});
      clearSavedViewState();
      navigateToList(undefined);
    });

  const setInboxIds = (ids: string[] | undefined) => {
    closeThread();
    setState({
      inboxIds: normalizeInboxSelection(ids),
      aliasFilter: undefined,
    });
  };
  const setAliasFilter = (
    alias: NonNullable<EmailViewState['aliasFilter']>
  ) => {
    closeThread();
    setState({
      inboxIds: [alias.inboxId],
      aliasFilter: { ...alias, emailAddress: alias.emailAddress.toLowerCase() },
    });
  };

  createInboxSelectionReconciliation({
    // A view's inboxes are part of its definition: one that is no longer
    // linked matches nothing rather than widening to every inbox.
    selectedIds: () => (savedViewActive() ? undefined : state.inboxIds),
    loadedLinks: () =>
      linksQuery.isSuccess ? linksQuery.data.links : undefined,
    // Widening stale scope to all inboxes should preserve the current thread.
    clearSelection: () =>
      setState({ inboxIds: undefined, aliasFilter: undefined }),
  });

  const setFacets = (facets: EmailViewState['facets']) => {
    closeThread();
    setState('facets', reconcile(normalizeFacetSelection(facets)));
  };
  const setFilters = (filters: Partial<EmailListFilters>) => {
    closeThread();
    batch(() => {
      if (filters.facets)
        setState('facets', reconcile(normalizeFacetSelection(filters.facets)));
      if (filters.conditions)
        setState('conditions', reconcile(filters.conditions));
      if ('inboxIds' in filters)
        setState({
          inboxIds: normalizeInboxSelection(filters.inboxIds),
          aliasFilter: undefined,
        });
    });
  };
  const filterBaseline = () =>
    emailTabFilterState(savedViewActive() ? 'all' : state.tab);
  const filtersChanged = createMemo(
    () => !emailFilterStatesEqual(state, filterBaseline())
  );
  const clearFilters = () =>
    setFilters({ ...filterBaseline(), inboxIds: undefined });

  const setFocusSort = (sort: EmailFocusSort) => setState('focusSort', sort);

  // Filters by a single tag without changing tabs. Used by the inline
  // "filter by tag" button on entity rows.
  const filterByTag = (optionId: string) => {
    closeThread();
    setState(
      'facets',
      reconcile(
        normalizeFacetSelection({
          ...filterBaseline().facets,
          tags: [optionId],
        })
      )
    );
  };

  const tagViewTitle = () => {
    const tagIds = state.facets.tags ?? [];
    if (state.tab !== 'all' || tagIds.length === 0 || savedViewActive())
      return undefined;
    const labels = listTagOptions(tagSets())
      .filter((tag) => tagIds.includes(tag.id))
      .map((tag) => tag.label);
    return labels.length > 0 ? labels.join(', ') : undefined;
  };

  const [readingPane, setReadingPane] = usePreference(
    'macro:pref:email:reading-pane',
    { default: false }
  );

  const isSidebarSectionOpen = (id: string) =>
    !state.collapsedSidebarSectionIds.includes(id);

  const setSidebarSectionOpen = (id: string, open: boolean) =>
    setState(
      'collapsedSidebarSectionIds',
      setSidebarSectionCollapsed(id, open)
    );
  return {
    state,
    setState,
    setTab,
    setInboxIds,
    setAliasFilter,
    setFacets,
    setFilters,
    filterBaseline,
    filtersChanged,
    clearFilters,
    setFocusSort,
    filterByTag,
    tagViewTitle,
    source,
    list,
    registerListActivationHandler,
    selectedThread,
    composing,
    openThread,
    closeThread,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
    readingPane,
    setReadingPane,
    savedViewsEnabled,
    savedViews,
    savedViewsList,
    savedViewSource,
    savedViewActive,
    savedViewScope: () => (disposed ? undefined : savedViewScope()),
    selectSavedView,
    leaveSavedView,
    inboxOptions: () =>
      linksQuery.isSuccess
        ? linksQuery.data.links.map((link) => ({
            id: link.id,
            label: link.email_address,
          }))
        : [],
  };
});
