import { normalizeFacetSelection } from '@app/features/soup/filters/facets/selection';
import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import { makePersistedState } from '@app/lib/persistence';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import type { ContextProviderProps } from '@solid-primitives/context';
import {
  createStore,
  produce,
  reconcile,
  type SetStoreFunction,
  type Store,
} from 'solid-js/store';
import { createInboxViewPersistence } from './persistence';
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
  const initial = props.initialState ?? {};
  const initialTab = initial.tab ?? 'signal';
  const [state, setState] = makePersistedState(
    createStore<InboxViewState>({
      tab: initialTab,
      search: initial.search ?? '',
      groupBy: initial.groupBy ?? defaultGroupBy(initialTab),
      facets: normalizeFacetSelection(initial.facets),
    }),
    createInboxViewPersistence({
      handle: panel.handle,
      restoreEntryState: props.initialState === undefined,
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
    setState('facets', reconcile(normalizeFacetSelection(facets)));
  };

  return {
    state,
    setState,
    setTab,
    setFacets,
  };
});
