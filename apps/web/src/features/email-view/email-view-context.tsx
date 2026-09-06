import { registerInboxFilterSplit } from '@app/features/next-soup/soup-view/inbox-filter-controllers';
import { normalizeFacetSelection } from '@app/features/soup';
import { makePersistedState } from '@app/lib/persistence';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import type { ContextProviderProps } from '@solid-primitives/context';
import { onCleanup } from 'solid-js';
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
};

export const [EmailViewProvider, useEmailView] = createAssertedContextProvider<
  EmailViewContext,
  EmailViewProviderProps
>('EmailView', (props) => {
  const panel = useSplitPanelOrThrow();
  const initial = props.initialState ?? {};

  const [state, setState] = makePersistedState(
    createStore<EmailViewState>({
      tab: initial.tab ?? DEFAULT_EMAIL_TAB,
      search: initial.search ?? '',
      inboxIds:
        initial.inboxIds === undefined ? undefined : [...initial.inboxIds],
      facets: normalizeFacetSelection(initial.facets),
    }),
    createEmailViewPersistence({
      handle: panel.handle,
      restoreEntryState: props.initialState === undefined,
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
  };
});
