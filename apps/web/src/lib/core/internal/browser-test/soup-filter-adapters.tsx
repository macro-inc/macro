import type { ListView } from '@app/constants/list-views';
import { createCrmCollectionFilters } from '@app/features/crm/filter-adapter';
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
import { createSignal, type Signal } from 'solid-js';
import { SELECTED, VIEWER } from './list-filter-adapters';

export const [SoupFilterFixtureProvider, useSoupView] =
  createAssertedContextProvider('SoupFilterFixture', () => {
    const mode = new URLSearchParams(location.search).get('soup-filters');
    const [view, setView] = createSignal<ListView>(
      mode === 'crm' ? 'companies' : mode === 'home' ? 'home' : 'tasks'
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
      (typeof SOUP_FILTERS)[number],
      string
    >({ configs: SOUP_FILTERS });
    predicates.set(
      mode === 'crm'
        ? { and: ['crm-company-active'] }
        : (initial?.clientFilters ?? {})
    );
    const crm =
      mode === 'crm'
        ? createCrmCollectionFilters(
            {
              userId: () => VIEWER,
              createTeamSource: () => ({
                data: {
                  team: { id: 'fixture-team', crm_enabled: true },
                  members: [
                    { user_id: VIEWER, role: 'member' },
                    { user_id: 'macro|teammate@example.com', role: 'member' },
                  ],
                },
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: true,
                refetch: async () => {},
              }),
            },
            { predicates },
            () => false,
            { stages: () => [], filterStages: () => [] }
          )
        : undefined;
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
      extensions: { selectFilters: crm?.facets ?? [] },
      owners: () => crm?.state.ownerFilter() ?? [],
      stages: () => crm?.state.stageFilter() ?? [],
      soup: {
        predicates,
        sort: {
          active: sort,
          setAll: (ids: string[]) => setSort(ids.map((id) => ({ id }))),
        },
      },
      seedSelections: () => {
        if (crm) {
          crm.state.setOwnerFilter([
            SELECTED,
            'unavailable-person',
            NO_ASSIGNEE,
          ]);
          crm.state.setStageFilter(['kept-stage']);
          return;
        }
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
export function useEntryState<T>(_key: string, options: { default: T }) {
  return createSignal(options.default);
}
export function makeFlaggedPersisted<T>(state: Signal<T>) {
  return state;
}
export function idToDisplayName(id: string) {
  if (id === VIEWER) return 'Viewer';
  if (id === SELECTED) return 'Selected Person';
  return id.slice(6);
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
