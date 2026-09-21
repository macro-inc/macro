import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import { makePersistedState } from '@app/lib/persistence';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import type { ContextProviderProps } from '@solid-primitives/context';
import {
  createStore,
  produce,
  reconcile,
  type SetStoreFunction,
  type Store,
} from 'solid-js/store';
import {
  createInboxViewPersistence,
  normalizeInboxFacets,
} from './persistence';
import type {
  InboxGroupBy,
  InboxTab,
  InboxViewState,
  InboxViewStateOptions,
} from './types';

type InboxViewProviderProps = ContextProviderProps & {
  initialState?: InboxViewStateOptions;
};

export type InboxViewContext = {
  state: Store<InboxViewState>;
  setState: SetStoreFunction<InboxViewState>;
  setTab: (tab: InboxTab) => void;
  setFacets: (facets: FacetSelection) => void;
};

function defaultGroupBy(tab: InboxTab): InboxGroupBy {
  return tab === 'reminders' ? 'none' : 'date';
}

export const [InboxViewProvider, useInboxView] = createAssertedContextProvider<
  InboxViewContext,
  InboxViewProviderProps
>('InboxView', (props) => {
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();
  const initial = props.initialState ?? {};
  const initialTab = initial.tab ?? 'signal';
  const [state, setState] = makePersistedState(
    createStore<InboxViewState>({
      tab: initialTab,
      search: initial.search ?? '',
      groupBy: initial.groupBy ?? defaultGroupBy(initialTab),
      facets: normalizeInboxFacets(initial.facets),
    }),
    createInboxViewPersistence({
      handle: panel.handle,
      userId,
      restoreEntryState: props.initialState === undefined,
      restorePreferences: initial.facets === undefined,
    })
  );

  const setTab = (tab: InboxTab) => {
    if (state.tab === tab) return;

    setState(
      produce((draft) => {
        draft.tab = tab;
        draft.groupBy = defaultGroupBy(tab);
      })
    );
  };

  const setFacets = (facets: FacetSelection) => {
    setState('facets', reconcile(normalizeInboxFacets(facets)));
  };

  return {
    state,
    setState,
    setTab,
    setFacets,
  };
});
