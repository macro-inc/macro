import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import {
  createListController,
  type ListActivation,
  type ListController,
  listOwnedSlotName,
} from '@app/components/list';
import { setSidebarSectionCollapsed } from '@app/components/view-shell';
import { useInlinePreviewLayout } from '@app/components/view-shell/use-inline-preview-layout';
import { composeDraftSearch } from '@app/features/email-compose/compose-route-draft';
import type {
  SavedViewSource,
  SavedViewsSource,
} from '@app/features/saved-views/context/saved-views-source';
import {
  createSavedViewCreation,
  type NewSavedView,
  type SavedViewCreation,
} from '@app/features/saved-views/primitives/create-saved-view-creation';
import {
  createTagFacetContext,
  normalizeFacetSelection,
} from '@app/features/soup';
import { registerListNavigationSource } from '@app/features/soup/collection/list-navigation-source';
import { t } from '@app/lib/i18n';
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
import {
  enableEmailWideSearch,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { markRowNotificationsSeenOnOpen } from '@notifications/mark-row-seen';
import { listTagOptions } from '@property/tags/list-tag-options';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import { useEmailLinksQuery } from '@queries/email/link';
import type { ContextProviderProps } from '@solid-primitives/context';
import deepEqual from 'fast-deep-equal';
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
import {
  canSearchEmailTab,
  DEFAULT_EMAIL_FOCUS_SORT,
  DEFAULT_EMAIL_TAB,
  type EmailShownView,
  isEmailInboxTab,
} from './constants';
import {
  emailDetailSearch,
  emailTabSearch,
  emailTabSearchCodec,
} from './email-route';
import {
  EMAIL_SAVED_VIEW_KIND,
  type EmailFilterState,
  type EmailSavedViewConfig,
  type EmailSavedViewFilters,
  emailFilterStatesEqual,
  emailTabFilterState,
  emailTabRefinements,
  type MaterializedEmailSavedView,
  materializeEmailSavedView,
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
import {
  emailSearchScopeForTab,
  emailSearchScopeTab,
  formatEmailSearch,
  type ParsedEmailSearch,
  parseEmailSearch,
} from './search/email-search-scope';
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
  /**
   * Opens a tab. During a search it narrows the search to that tab's view
   * (`in:<view>`) and keeps the words; a tab with no view in the search index
   * (Scheduled, Reminders, Spam, Trash), or a search with no words typed yet,
   * ends the search.
   */
  setTab: (tab: EmailTab) => void;
  /** Opens the Inbox view last open (Focus, Signal or Noise), or `in:inbox`. */
  selectInbox: () => void;
  /**
   * The view the navigation and the header show as selected: the open tab,
   * or the view the search on screen runs in (`inbox` for the whole Inbox);
   * `search` for a search of all mail, which selects none.
   */
  shownTab: Accessor<EmailShownView>;
  /** The search field holds a query, whatever it says. */
  searchOpen: Accessor<boolean>;
  /** Focus, Signal and Noise show as tabs: in the Inbox, never in a search. */
  showsInboxTabs: Accessor<boolean>;
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
  /**
   * The search on screen: its words and the view an `in:` filter narrows them
   * to. Text with no words yet keeps the search before it.
   */
  parsedSearch: Accessor<ParsedEmailSearch>;
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
  navigateToList: () => Promise<void>;
  isSidebarSectionOpen: (id: string) => boolean;
  setSidebarSectionOpen: (id: string, open: boolean) => void;
  /** Open threads beside the list instead of in its place (desktop). */
  readingPane: Accessor<boolean>;
  setReadingPane: (enabled: boolean) => void;
  /** Whether saved views show at all; their sources may still be mounted. */
  savedViewsEnabled: Accessor<boolean>;
  savedViewCreation?: SavedViewCreation;
  discardNewSavedView: () => void;
  startSavedView: (
    filters: EmailSavedViewFilters,
    name?: string,
    afterStart?: () => void,
    changed?: boolean,
    appearance?: NewSavedView['appearance']
  ) => void;
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
  const inlinePreviewLayout = useInlinePreviewLayout();
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
  const savedViewsEnabled = () => Boolean(props.savedViewSource);
  const selectedSavedViewId = () =>
    savedViewsEnabled() ? tabSearch.savedView : undefined;
  const savedViewsList = props.savedViewsSource?.();
  const savedViewSource = props.savedViewSource?.(selectedSavedViewId);
  let savedViewCreation: SavedViewCreation | undefined;
  const savedViewActive = () =>
    Boolean(selectedSavedViewId() || savedViewCreation?.current());
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
  if (savedViewSource && savedViewsList)
    savedViewCreation = createSavedViewCreation({
      kind: 'email',
      viewerId: userId,
      list: savedViewsList.items,
      capture: () => {
        const value = savedViews?.capture();
        return value?.isOk() ? value.value : undefined;
      },
      equal: deepEqual,
    });
  if (savedViewSource) {
    savedViews = createEmailSavedViewDraft({
      source: savedViewSource,
      selectedId: selectedSavedViewId,
      viewerId: userId,
      state,
      facetContext,
      creating: () => Boolean(savedViewCreation?.current()),
      apply: applySavedView,
    });
  }
  const savedViewScope = createMemo(() => ({
    id: selectedSavedViewId(),
    viewerId: userId(),
    navigation: savedViewNavigation(),
    draftId: savedViewCreation?.current()?.id,
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
        if (!savedViewSource || savedViewCreation?.current()) return;
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
        if (id && accountChanged)
          fireAndForget(navigateToList(undefined), 'email-view');
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
  const searchOpen = () =>
    canSearchEmailTab(state.tab) && state.search.trim() !== '';
  const typedSearch = createMemo(() => parseEmailSearch(state.search));
  // A search covers all mail from any tab; only an `in:` filter narrows it.
  // Text with no words (an operator still being typed, or a view alone) runs
  // no search of its own, so the last one that had words stays on screen.
  const parsedSearch = createMemo<ParsedEmailSearch>(
    (onScreen) => {
      const typed = typedSearch();
      if (typed.query === '' && state.search.trim() !== '') return onScreen;
      return typed;
    },
    { query: '' }
  );
  const shownTab = (): EmailShownView => {
    const { query, scope } = parsedSearch();
    // With no search to stay on, the list is still the open tab's.
    if (!searchOpen() || query === '') return state.tab;

    if (!scope) return 'search';
    return emailSearchScopeTab(scope) ?? 'inbox';
  };
  const showsInboxTabs = () =>
    !searchOpen() && !savedViewActive() && isEmailInboxTab(state.tab);
  const listInput: EmailDataSourceInput = {
    get tab() {
      return listFilters().tab;
    },
    get facets() {
      return listFilters().facets;
    },
    get search() {
      return parsedSearch().query;
    },
    get searchScope() {
      return parsedSearch().scope ?? 'all';
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
    savedViews?.view().kind === 'new' ||
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
      keepRowsWhileSearching: () => isFeatureEnabled(enableEmailWideSearch),
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
      inlinePreviewLayout() &&
      !(event?.shiftKey || event?.metaKey || event?.ctrlKey || event?.altKey)
    );
  };
  const navigateToList = async (savedView: string | undefined) => {
    await navigate(
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
    );
  };
  const closeThread = () =>
    fireAndForget(navigateToList(tabSearch.savedView), 'email-view');
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
  const setTabNow = (requestedTab: EmailTab) => {
    const tab = availableTab(requestedTab);
    if (savedViewActive()) {
      batch(() => {
        setSavedViewNavigation({});
        clearSavedViewState(tab);
        fireAndForget(navigateToList(undefined), 'email-view');
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

  // During a search, a tab narrows it rather than leaving it: the navigation
  // reads as the view searched, and the words stay.
  const selectTab = (tab: EmailTab, scope = emailSearchScopeForTab(tab)) => {
    if (savedViewActive() || !searchOpen()) {
      setTabNow(tab);
      return;
    }

    const { query } = typedSearch();
    batch(() => {
      setTabNow(tab);
      // With no words typed there is nothing to narrow, so the tab just opens.
      if (!scope || query === '') {
        setState('search', '');
        return;
      }

      setState(
        'search',
        formatEmailSearch(scope === 'all' ? undefined : scope, query)
      );
    });
  };
  const runTabSelection = (select: () => void) => {
    if (savedViewCreation) savedViewCreation.run(select);
    else select();
  };

  // Opening a view replaces the current filters; its definition fills them in.
  const selectSavedViewNow = (id: string) => {
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
      fireAndForget(navigateToList(id), 'email-view');
    });
  };
  const discardNewSavedView = () => {
    savedViewCreation?.discard();
    if (!selectedSavedViewId() && state.beforeSavedView) clearSavedViewState();
  };
  const selectSavedView = (id: string) => {
    const select = () => {
      savedViewCreation?.discard();
      selectSavedViewNow(id);
    };
    if (savedViewCreation) savedViewCreation.run(select);
    else select();
  };
  const startSavedView = (
    filters: EmailSavedViewFilters,
    name = t('viewMenus.newView'),
    afterStart?: () => void,
    changed = false,
    appearance?: NewSavedView['appearance']
  ) => {
    const start = () => {
      const config: EmailSavedViewConfig = {
        kind: EMAIL_SAVED_VIEW_KIND,
        version: 1 as const,
        filters,
      };
      batch(() => {
        applySavedView(materializeEmailSavedView(config));
        savedViewCreation?.begin(config, name, changed, appearance);
        setSavedViewNavigation({});
        savedViewCreation?.internalNavigation(() =>
          fireAndForget(navigateToList(undefined), 'email-view')
        );
      });
      afterStart?.();
    };
    if (savedViewCreation) savedViewCreation.run(start);
    else start();
  };
  const leaveSavedView = () => {
    const leave = () =>
      batch(() => {
        discardNewSavedView();
        setSavedViewNavigation({});
        clearSavedViewState();
        fireAndForget(navigateToList(undefined), 'email-view');
      });
    if (savedViewCreation) savedViewCreation.run(leave);
    else leave();
  };

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
    setTab: (tab) => runTabSelection(() => selectTab(tab)),
    selectInbox: () =>
      runTabSelection(() =>
        selectTab(
          !savedViewActive() && isEmailInboxTab(state.tab)
            ? state.tab
            : 'important',
          'inbox'
        )
      ),
    shownTab,
    searchOpen,
    showsInboxTabs,
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
    parsedSearch,
    list,
    registerListActivationHandler,
    selectedThread,
    composing,
    openThread,
    closeThread,
    navigateToList: () => navigateToList(tabSearch.savedView),
    isSidebarSectionOpen,
    setSidebarSectionOpen,
    readingPane,
    setReadingPane,
    savedViewsEnabled,
    savedViews,
    savedViewCreation,
    discardNewSavedView,
    startSavedView,
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
