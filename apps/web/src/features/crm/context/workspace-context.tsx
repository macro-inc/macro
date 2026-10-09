import type { EntityData } from '@entity';
import {
  type Accessor,
  createContext,
  type Setter,
  useContext,
} from 'solid-js';
import type { EntityActionListState } from '../../next-soup/actions/entity-action-context';
import type { SoupState } from '../../next-soup/create-soup-state';
import type { QueryStore } from '../../next-soup/filters/filter-store/query-store';

/** Collection capabilities consumed by CRM views, supplied by the host adapter. */
export type CrmWorkspace = {
  host: {
    scopeId: string;
    isActive: Accessor<boolean>;
    focus(): void;
    captureEntryState(): void;
    openCompany(entity: EntityData, newSplit: boolean): void;
    openSettings(): void;
    openTeamSettings(): void;
  };

  soup: EntityActionListState & {
    selection: Pick<SoupState['selection'], 'clear' | 'selected'>;
    predicates: Pick<
      SoupState['predicates'],
      'set' | 'isActive' | 'toggle' | 'andIds' | 'orIds'
    >;
    sort: Pick<SoupState['sort'], 'setAll' | 'active' | 'flip'>;
    grouping: Pick<SoupState['grouping'], 'activeGroupId' | 'setActiveGroupId'>;
  };
  source: {
    error: Accessor<Error | undefined | null>;
    data: Accessor<EntityData[]>;
    isLoading: Accessor<boolean>;
    isFetching: Accessor<boolean>;
    hasNextPage: Accessor<boolean>;
    fetchNextPage(): Promise<void>;
  };
  queryFilters: Pick<QueryStore, 'state' | 'set' | 'replace'>;
  searchText: Accessor<string>;
  setSearchText(value: string): void;
  activeTab: Accessor<string | undefined>;
  setActiveTab: Setter<string | undefined>;
  stageFilter: Accessor<string[]>;
  setStageFilter: Setter<string[]>;
  ownerFilter: Accessor<string[]>;
  setOwnerFilter: Setter<string[]>;
};
const Context = createContext<CrmWorkspace>();
export const CrmWorkspaceProvider = Context.Provider;
export function useCrmWorkspace(): CrmWorkspace {
  const value = useContext(Context);
  if (!value)
    throw new Error('CRM workspace views require a CrmWorkspaceProvider');
  return value;
}
