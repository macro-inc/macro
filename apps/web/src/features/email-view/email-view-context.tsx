import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import {
  createListController,
  type ListActivation,
  type ListController,
  listOwnedSlotName,
} from '@app/components/list';
import { setSidebarSectionCollapsed } from '@app/components/view-shell';
import { normalizeFacetSelection } from '@app/features/soup';
import { registerListNavigationSource } from '@app/features/soup/collection/list-navigation-source';
import { makePersistedState } from '@app/lib/persistence';
import {
  createSearchParams,
  useNavigate,
  useRouteParams,
} from '@app/lib/split-router';
import { usePreference } from '@app/preferences/use-preference';
import { emailSplitRoute, emailThreadRoute } from '@app/routes/routes';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import { useEmailLinksQuery } from '@queries/email/link';
import type { ContextProviderProps } from '@solid-primitives/context';
import {
  type Accessor,
  createEffect,
  createMemo,
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
import { normalizeInboxSelection } from './inbox-selection';
import { createEmailViewPersistence } from './persistence';
import { createInboxSelectionReconciliation } from './primitives/inbox-selection-reconciliation';
import {
  type EmailDataSource,
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
  setFocusSort: (sort: EmailFocusSort) => void;
  /**
   * Shows the given tags across the whole mailbox: a non-empty selection
   * lands on the All tab. Clearing keeps the current tab.
   */
  showTags: (tagIds: string[]) => void;
  /**
   * Filters by a single tag without changing tabs. Used by the inline
   * "filter by tag" button on entity rows.
   */
  filterByTag: (optionId: string) => void;
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
};

export const [EmailViewProvider, useEmailView] = createAssertedContextProvider<
  EmailViewContext,
  EmailViewProviderProps
>('EmailView', (props) => {
  const panel = useSplitPanelOrThrow();
  const navigate = useNavigate();
  const routeParams = useRouteParams(emailThreadRoute);
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

  const [persistedState, setState] = makePersistedState(
    createStore<EmailViewState>({
      tab: availableTab(initial.tab ?? DEFAULT_EMAIL_TAB),
      search: initial.search ?? '',
      inboxIds: initial.aliasFilter
        ? [initial.aliasFilter.inboxId]
        : normalizeInboxSelection(initial.inboxIds),
      ...(initial.aliasFilter ? { aliasFilter: initial.aliasFilter } : {}),
      facets: normalizeFacetSelection(initial.facets),
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
            draft.facets = {};
          })
        );
      }
    )
  );

  createEffect(() => {
    if (isTabOff(state.tab)) {
      setState({ tab: DEFAULT_EMAIL_TAB, search: '', facets: {} });
    }
  });

  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () =>
    useEmailDataSource(state, { tagSets, tagSetsReady })
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

  const opensInline = (options?: EntityDetailNavigationOptions) => {
    const event = options?.event;
    return (
      !isTouchDevice() &&
      !(event?.shiftKey || event?.metaKey || event?.ctrlKey || event?.altKey)
    );
  };
  const closeThread = () => {
    fireAndForget(
      navigate(
        { route: emailSplitRoute, params: {} },
        {
          search: {
            [emailTabSearch.namespace]: emailTabSearchCodec.serialize({
              tab: state.tab,
            }),
          },
        }
      ),
      'email-view'
    );
  };
  const openThread = (
    thread: EmailThreadTarget,
    options?: EntityDetailNavigationOptions & { replace?: boolean }
  ) => {
    if (!opensInline(options)) return false;
    const selection = { type: 'email' as const, id: thread.id };
    // The router may refuse a claimed destination. Check compatibility without
    // claiming it until the accepted route changes.
    if (!selectPreview.canSelect(selection)) return true;
    fireAndForget(
      navigate(
        { route: emailThreadRoute, params: { threadId: thread.id } },
        {
          replace: options?.replace,
          search: {
            [emailDetailSearch.namespace]: {},
            [emailTabSearch.namespace]: emailTabSearchCodec.serialize({
              tab: state.tab,
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
    if (state.tab === tab) {
      closeThread();
      return;
    }
    setState(
      produce((draft) => {
        if (draft.tab === 'reminders' || tab === 'reminders') draft.search = '';
        draft.tab = tab;
        draft.facets = {};
      })
    );
    closeThread();
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

  // This belongs to the view lifecycle, even while every inbox picker is unmounted.
  const linksQuery = useEmailLinksQuery();
  createInboxSelectionReconciliation({
    selectedIds: () => state.inboxIds,
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

  const setFocusSort = (sort: EmailFocusSort) => setState('focusSort', sort);

  // A tag reaches across every mailbox slice, so choosing one from a narrower
  // tab moves to All; as with `setTab`, that move drops the tab's other filters.
  const showTags = (tagIds: string[]) => {
    setState(
      produce((draft) => {
        const movesToAll = tagIds.length > 0 && draft.tab !== 'all';
        if (movesToAll) draft.tab = 'all';
        draft.facets = normalizeFacetSelection({
          ...(movesToAll ? {} : draft.facets),
          tags: tagIds,
        });
      })
    );
    closeThread();
  };

  // Filters by a single tag without changing tabs. Used by the inline
  // "filter by tag" button on entity rows.
  const filterByTag = (optionId: string) => {
    closeThread();
    setState(
      'facets',
      reconcile(normalizeFacetSelection({ tags: [optionId] }))
    );
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
    setFocusSort,
    showTags,
    filterByTag,
    source,
    list,
    registerListActivationHandler,
    selectedThread,
    openThread,
    closeThread,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
    readingPane,
    setReadingPane,
  };
});
