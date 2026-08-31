import {
  type FacetSelection,
  normalizeFacetSelection,
} from '@app/features/soup';
import { makePersistedState } from '@app/lib/persistence';
import { createStore, produce } from 'solid-js/store';
import {
  type CreateInboxViewPersistenceOptions,
  createInboxViewPersistence,
} from './persistence';
import type { InboxGroupBy, InboxTab } from './types';

export type CreateInboxViewStateOptions = {
  tab?: InboxTab;
  search?: string;
  groupBy?: InboxGroupBy;
  facets?: FacetSelection;
};

export type InboxViewSnapshot = {
  tab: InboxTab;
  search: string;
  groupBy: InboxGroupBy;
  facets: FacetSelection;
};

export type CreateInboxViewStateContext = Pick<
  CreateInboxViewPersistenceOptions,
  'handle'
>;

function defaultGroupBy(tab: InboxTab): InboxGroupBy {
  return tab === 'reminders' ? 'none' : 'date';
}

/** Canonical setter-owned state for one mounted Inbox view. */
export function createInboxViewState(
  options?: CreateInboxViewStateOptions,
  context?: CreateInboxViewStateContext
) {
  const initial = options ?? {};
  const initialTab = initial.tab ?? 'signal';

  const rawState = createStore<InboxViewSnapshot>({
    tab: initialTab,
    search: initial.search ?? '',
    groupBy: initial.groupBy ?? defaultGroupBy(initialTab),
    facets: normalizeFacetSelection(initial.facets),
  });
  const persisted = context
    ? makePersistedState(
        rawState,
        createInboxViewPersistence({
          ...context,
          restoreEntryState: options === undefined,
        })
      )
    : rawState;
  const [state, setState] = persisted;

  const setTab = (tab: InboxTab) => {
    if (state.tab === tab) return;

    setState(
      produce((draft) => {
        draft.tab = tab;
        draft.groupBy = defaultGroupBy(tab);
        draft.facets = {};
      })
    );
  };

  const setFacetOption = (
    facetId: string,
    optionId: string,
    selected: boolean
  ) => {
    const next = new Set(state.facets[facetId] ?? []);

    if (selected) {
      next.add(optionId);
    } else {
      next.delete(optionId);
    }

    const facets = { ...state.facets, [facetId]: [...next] };
    setState('facets', normalizeFacetSelection(facets));
  };

  return {
    setState,
    tab: () => state.tab,
    setTab,

    search: () => state.search,
    setSearch: (search: string) => setState('search', search),

    groupBy: () => state.groupBy,
    setGroupBy: (groupBy: InboxGroupBy) => setState('groupBy', groupBy),

    facets: () => state.facets,
    setFacetOption,
    clearFacets: () => setState('facets', {}),

    snapshot: (): InboxViewSnapshot => ({
      tab: state.tab,
      search: state.search,
      groupBy: state.groupBy,
      facets: normalizeFacetSelection(state.facets),
    }),

    activeFacetCount: () =>
      Object.values(state.facets).reduce(
        (count, optionIds) => count + optionIds.length,
        0
      ),
  };
}

export type InboxViewState = ReturnType<typeof createInboxViewState>;
