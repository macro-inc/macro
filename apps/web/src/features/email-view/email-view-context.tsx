import { setSidebarSectionCollapsed } from '@app/components/view-shell';
import { registerInboxFilterSplit } from '@app/features/next-soup/soup-view/inbox-filter-controllers';
import { normalizeFacetSelection } from '@app/features/soup';
import { makePersistedState } from '@app/lib/persistence';
import { usePreference } from '@app/lib/preferences/use-preference';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import type { ContextProviderProps } from '@solid-primitives/context';
import { type Accessor, onCleanup, type Setter } from 'solid-js';
import {
  createStore,
  produce,
  reconcile,
  type SetStoreFunction,
  type Store,
} from 'solid-js/store';
import { DEFAULT_EMAIL_TAB } from './constants';
import { createEmailViewPersistence } from './persistence';
import type { EmailTab, EmailViewState, EmailViewStateOptions } from './types';

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
  setOpenThreadId: (threadId: string | undefined) => void;
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
  const userId = useUserId();
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

  // A tab is a fresh slice of the mailbox: filters chosen for one tab (Done
  // on Signal, say) would silently narrow the next, so they reset with it.
  const setTab = (tab: EmailTab) => {
    if (state.tab === tab) return;

    setState(
      produce((draft) => {
        draft.tab = tab;
        draft.facets = {};
      })
    );
  };

  const setInboxIds = (ids: string[] | undefined) =>
    setState('inboxIds', ids === undefined ? undefined : [...ids]);

  const setFacets = (facets: EmailViewState['facets']) => {
    setState('facets', reconcile(normalizeFacetSelection(facets)));
  };

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
  };

  const setOpenThreadId = (threadId: string | undefined) =>
    setState('openThreadId', threadId);

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
    setOpenThreadId,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
    previewOpen,
    setPreviewOpen,
  };
});
