import type { EntityData } from '@entity';
import { useQuickAccess, isEntityItem } from '@core/context/quickAccess';
import {
  type Accessor,
  createContext,
  createMemo,
  type FlowComponent,
  useContext,
} from 'solid-js';

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
  const quickAccess = useQuickAccess();
  const allItems = quickAccess.useList();

  const entityPool = createMemo<EntityData[]>(() =>
    allItems()
      .filter(isEntityItem)
      .map((item) => item.data)
  );

  return (
    <SearchContext.Provider value={{ entityPool }}>
      {props.children}
    </SearchContext.Provider>
  );
};
