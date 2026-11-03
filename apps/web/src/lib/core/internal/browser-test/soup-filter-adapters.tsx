import type { ListView } from '@app/constants/list-views';
import {
  type FilterContext,
  NO_ASSIGNEE,
  SOUP_FILTERS,
} from '@app/features/next-soup/filters/configs';
import { createPredicatesStore } from '@app/features/next-soup/filters/filter-store/predicates-store';
import { createQueryStore } from '@app/features/next-soup/filters/filter-store/query-store';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { createAssertedContextProvider } from '@core/context/createContext';
import type { EntityData } from '@entity';
import { createSignal } from 'solid-js';
import { SELECTED, VIEWER } from './list-filter-adapters';

export const [SoupFilterFixtureProvider, useSoupView] =
  createAssertedContextProvider('SoupFilterFixture', () => {
    const [view, setView] = createSignal<ListView>(
      new URLSearchParams(location.search).get('soup-filters') === 'home'
        ? 'home'
        : 'tasks'
    );
    const [activeTab, setActiveTab] = createSignal('all');
    const initial = getViewPreset(view(), activeTab(), {
      userId: VIEWER,
      isTeamAdmin: false,
    });
    const queryFilters = createQueryStore({ initial: initial?.filters });
    const predicates = createPredicatesStore<
      EntityData,
      FilterContext,
      (typeof SOUP_FILTERS)[number]
    >({ configs: SOUP_FILTERS });
    predicates.set(initial?.clientFilters ?? {});
    const [assigneeFilter, setAssigneeFilter] = createSignal<string[]>([]);
    const [sort, setSort] = createSignal([{ id: 'updated_at' }]);
    return {
      view,
      activeTab,
      queryFilters,
      assigneeFilter,
      setAssigneeFilter,
      items: (): EntityData[] => [],
      readFilter: () => 'all',
      setReadFilter: () => {},
      inboxFilter: () => undefined,
      setInboxFilter: () => {},
      extensions: { selectFilters: [] },
      soup: {
        predicates,
        sort: {
          active: sort,
          setAll: (ids: string[]) => setSort(ids.map((id) => ({ id }))),
        },
      },
      seedSelections: () => {
        setAssigneeFilter([SELECTED, NO_ASSIGNEE, 'unavailable-person']);
        predicates.toggle({ and: ['assignee'] });
        queryFilters.set({ include: { documentOwnerId: [SELECTED] } });
      },
      showOwned: () => {
        setView('documents');
        setActiveTab('owned');
        setAssigneeFilter([]);
        const preset = getViewPreset('documents', 'owned', {
          userId: VIEWER,
          isTeamAdmin: false,
        });
        queryFilters.replace(preset?.filters ?? null);
        predicates.set(preset?.clientFilters ?? {});
      },
      refineOwned: () =>
        queryFilters.set({ include: { documentOwnerId: [SELECTED] } }),
    };
  });
export function useSplitPanelOrThrow() {
  const state = useSoupView();
  return {
    handle: {
      content: () => ({ type: 'component' as const, id: state.view() }),
    },
    splitHotkeyScope: 'global',
    panelRef: () => document.querySelector<HTMLElement>('main'),
  };
}
export function useTagFilter() {
  return {
    hasTags: () => false,
    activeIds: () => [],
    options: () => [],
    optionsById: () => new Map(),
    onChange: () => {},
  };
}
export function useInboxPicker() {
  return {
    hasMultiple: () => false,
    activeIds: () => [],
    options: () => [],
    reset: () => {},
    onChange: () => {},
    selectOnly: () => {},
  };
}
export const useGithubLinkStatusQuery = () => ({ data: undefined });
export const useAddInboxFlow = () => async () => {};
export function useContacts(): never {
  throw new Error('Unexpected full-directory read');
}
export function useContactsQuery(): never {
  throw new Error('Unexpected full-directory query');
}
