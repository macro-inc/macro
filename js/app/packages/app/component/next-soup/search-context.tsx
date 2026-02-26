import type { EntityData } from '@entity';
import type { EntityItem } from '@core/context/quickAccess';
import {
  type Accessor,
  createContext,
  createMemo,
  type FlowComponent,
  useContext,
} from 'solid-js';
import { useQuickAccessEntities } from '@core/component/Properties/component/modal';
import { EntityType } from '@service-properties/generated/schemas/entityType';

interface SearchContextValue {
  entityPool: Accessor<EntityData[]>;
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
  const { items } = useQuickAccessEntities(() => [
    EntityType.CHANNEL,
    EntityType.CHAT,
    EntityType.DOCUMENT,
    EntityType.PROJECT,
  ]);

  const entityPool = createMemo<EntityData[]>(() => {
    return items().map((item: EntityItem) => item.data);
  });

  return (
    <SearchContext.Provider value={{ entityPool }}>
      {props.children}
    </SearchContext.Provider>
  );
};
