import { type EntityTypeItemMap, useQuickAccessEntities } from '@property';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  type Accessor,
  createContext,
  type FlowComponent,
  useContext,
} from 'solid-js';

const SEARCH_ENTITY_TYPES = [
  EntityType.CHANNEL,
  EntityType.CHAT,
  EntityType.DOCUMENT,
  EntityType.PROJECT,
] as const;

type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export type SearchPoolItem = EntityTypeItemMap[SearchEntityType];

interface SearchContextValue {
  entityPool: Accessor<SearchPoolItem[]>;
}

const SearchContext = createContext<SearchContextValue>();

export const useSearchContext = () => {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearchContext can only be used under a SearchProvider');
  }
  return context;
};

export const SearchProvider: FlowComponent = (props) => {
  const { items } = useQuickAccessEntities(() => [...SEARCH_ENTITY_TYPES]);

  return (
    <SearchContext.Provider value={{ entityPool: items }}>
      {props.children}
    </SearchContext.Provider>
  );
};
