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
import type { CrmRecordRef, CrmRecordSection } from '../core/record';

/** A new `seek` asks to show the same message again. */
export type CrmCommentTarget = { commentId: string; seek: string };

/** Records opened inside the workspace; the route holds them. */
export type CrmRecordNavigation = {
  /** Records opened from the list, oldest first; empty on the list. */
  records: Accessor<readonly CrmRecordRef[]>;
  /** The shown record's tab; none is its Overview. */
  section: Accessor<CrmRecordSection | undefined>;
  /** A Discussion message of the shown record to scroll to. */
  commentTarget: Accessor<CrmCommentTarget | undefined>;
  /** Shows the last record of `trail` at its Overview. */
  open(trail: readonly CrmRecordRef[]): void;
  setSection(section: CrmRecordSection): void;
  /** Returns to the list the records were opened from. */
  close(): void;
};

/** The Customers location: a list tab, and the records opened from it. */
export type CrmRoute = CrmRecordNavigation & {
  tab: Accessor<string>;
  /** Shows the list of `tab`, closing any open record. */
  setTab(tab: string, options?: { replace?: boolean }): void;
};

/** Collection capabilities consumed by CRM views, supplied by the host adapter. */
export type CrmWorkspace = {
  host: {
    scopeId: string;
    isActive: Accessor<boolean>;
    focus(): void;
    captureEntryState(): void;
    openCompany(entity: EntityData, newSplit: boolean): void;
    /** CRM settings, shown in the workspace over its list or record. */
    settings: {
      isOpen: Accessor<boolean>;
      open(): void;
      close(): void;
    };
    openTeamSettings(): void;
    record: CrmRecordNavigation;
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
