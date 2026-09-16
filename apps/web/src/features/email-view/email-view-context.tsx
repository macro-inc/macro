import {
  createEntityDetailTarget,
  useEntityDetailNavigationStack,
} from '@app/components/entity-detail/EntityDetailNavigationStack';
import { listOwnedSlotName } from '@app/components/list';
import { setSidebarSectionCollapsed } from '@app/components/view-shell';
import { registerInboxFilterSplit } from '@app/features/next-soup/soup-view/inbox-filter-controllers';
import { normalizeFacetSelection } from '@app/features/soup';
import { makePersistedState } from '@app/lib/persistence';
import { usePreference } from '@app/lib/preferences/use-preference';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import type { ContextProviderProps } from '@solid-primitives/context';
import { type Accessor, createSignal, onCleanup, type Setter } from 'solid-js';
import {
  createStore,
  produce,
  reconcile,
  type SetStoreFunction,
  type Store,
} from 'solid-js/store';
import { DEFAULT_EMAIL_TAB } from './constants';
import { createEmailViewPersistence } from './persistence';
import {
  type EmailDataSource,
  useEmailDataSource,
} from './queries/use-email-query';
import type {
  EmailTab,
  EmailThreadTarget,
  EmailViewState,
  EmailViewStateOptions,
} from './types';

type EmailViewProviderProps = ContextProviderProps & {
  initialState?: EmailViewStateOptions;
};

export type EmailViewContext = {
  state: Store<EmailViewState>;
  setState: SetStoreFunction<EmailViewState>;
  setTab: (tab: EmailTab) => void;
  setInboxIds: (ids: string[] | undefined) => void;
  setFacets: (facets: EmailViewState['facets']) => void;
  /**
   * Shows the given tags across the whole mailbox: a non-empty selection
   * lands on the All tab. Clearing keeps the current tab.
   */
  showTags: (tagIds: string[]) => void;
  source: EmailDataSource;
  selectedThread: Accessor<EmailThreadTarget | undefined>;
  listFocusTarget: Accessor<string | undefined>;
  clearListFocusTarget: () => void;
  openThread: (thread: EmailThreadTarget) => void;
  closeThread: () => void;
  isSidebarSectionOpen: (id: string) => boolean;
  setSidebarSectionOpen: (id: string, open: boolean) => void;
  /**
   * Whether the view may open its preview pane on its own. Written by the
   * Preview toggle so an explicit close stays closed across visits; shares
   * the legacy mail view's key so the choice carries over.
   */
  previewOpen: Accessor<boolean>;
  setPreviewOpen: Setter<boolean>;
};

export const [EmailViewProvider, useEmailView] = createAssertedContextProvider<
  EmailViewContext,
  EmailViewProviderProps
>('EmailView', (props) => {
  const panel = useSplitPanelOrThrow();
  const navigationStack = useEntityDetailNavigationStack();
  const userId = useUserId();
  const tagSets = useTagSets();
  const tagSetsReady = useTagSetsReady();
  const initial = props.initialState ?? {};
  const [previewOpen, setPreviewOpen] = usePreference<boolean>(
    'macro:pref:soup:mail:preview-open',
    { default: true }
  );

  const [state, setState] = makePersistedState(
    createStore<EmailViewState>({
      tab: initial.tab ?? DEFAULT_EMAIL_TAB,
      search: initial.search ?? '',
      inboxIds:
        initial.inboxIds === undefined ? undefined : [...initial.inboxIds],
      facets: normalizeFacetSelection(initial.facets),
      openThreadId: initial.openThreadId,
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

  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () =>
    useEmailDataSource(state, { tagSets, tagSetsReady })
  );
  const [listFocusTarget, setListFocusTarget] = createSignal<string>();

  const selectedThread = (): EmailThreadTarget | undefined => {
    const entry = navigationStack.entries.find(
      (candidate) => candidate.data.type === 'email'
    );
    if (!entry || entry.data.type !== 'email') return undefined;
    return {
      id: entry.data.id,
      fallbackName: entry.data.fallbackName,
    };
  };

  const openThread = (thread: EmailThreadTarget) => {
    setListFocusTarget(thread.id);
    setState('openThreadId', thread.id);
    navigationStack.reset(
      createEntityDetailTarget(
        { type: 'email', id: thread.id },
        thread.fallbackName
      )
    );
  };

  const closeThread = () => {
    setState('openThreadId', undefined);
    navigationStack.clear();
  };

  if (state.openThreadId) {
    openThread({ id: state.openThreadId });
  }

  // A tab is a fresh slice of the mailbox: filters chosen for one tab (Done
  // on Signal, say) would silently narrow the next, so they reset with it.
  const setTab = (tab: EmailTab) => {
    closeThread();
    setListFocusTarget();
    if (state.tab === tab) return;

    setState(
      produce((draft) => {
        draft.tab = tab;
        draft.facets = {};
      })
    );
  };

  const setInboxIds = (ids: string[] | undefined) => {
    closeThread();
    setListFocusTarget();
    setState('inboxIds', ids === undefined ? undefined : [...ids]);
  };

  const setFacets = (facets: EmailViewState['facets']) => {
    closeThread();
    setListFocusTarget();
    setState('facets', reconcile(normalizeFacetSelection(facets)));
  };

  // A tag reaches across every mailbox slice, so choosing one from a narrower
  // tab moves to All; as with `setTab`, that move drops the tab's other filters.
  const showTags = (tagIds: string[]) => {
    closeThread();
    setListFocusTarget();
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
  };

  const isSidebarSectionOpen = (id: string) =>
    !state.collapsedSidebarSectionIds.includes(id);

  const setSidebarSectionOpen = (id: string, open: boolean) =>
    setState(
      'collapsedSidebarSectionIds',
      setSidebarSectionCollapsed(id, open)
    );

  // The classic sidebar's nested account rows scope the mail list by split id
  // (see `SidebarMailLink`); registering keeps them driving this view too, and
  // flushes a selection queued while navigating here.
  onCleanup(
    registerInboxFilterSplit(panel.handle.id, {
      inboxFilter: () => state.inboxIds,
      setInboxFilter: setInboxIds,
    })
  );

  return {
    state,
    setState,
    setTab,
    setInboxIds,
    setFacets,
    showTags,
    source,
    selectedThread,
    listFocusTarget,
    clearListFocusTarget: () => setListFocusTarget(),
    openThread,
    closeThread,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
    previewOpen,
    setPreviewOpen,
  };
});
