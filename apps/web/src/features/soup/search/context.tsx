import { useQuickAccess } from '@core/context/quickAccess';
import type { EntityData } from '@entity';
import { type EntityTypeItemMap, useQuickAccessEntities } from '@property';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  type Accessor,
  createContext,
  createSignal,
  type FlowComponent,
  onCleanup,
  useContext,
} from 'solid-js';

const SEARCH_ENTITY_TYPES = [
  EntityType.CHANNEL,
  EntityType.CHAT,
  EntityType.DOCUMENT,
  EntityType.PROJECT,
  EntityType.TASK,
] as const;

type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export type SoupSearchPoolItem = EntityTypeItemMap[SearchEntityType];

export type SoupSearchPoolEntry = {
  data: EntityData;
  bucket?: string;
};

interface SearchContextValue {
  /**
   * The rows Home, Drive, Tasks and Soup searches match locally, for a caller
   * whose `searching` is true while its search has text. The pool reads the
   * cache only while some caller is searching, and lists nothing otherwise:
   * a loaded pool rereads its cache list on every cache change.
   */
  entityPool: (searching: Accessor<boolean>) => Accessor<SoupSearchPoolEntry[]>;
  /**
   * Routines, kept out of `entityPool`: that pool also feeds the Home, Drive,
   * and Tasks searches, which never list routines. Workspace Search adds them.
   */
  routinePool: Accessor<SoupSearchPoolEntry[]>;
}

const SearchContext = createContext<SearchContextValue>();

export const useSearchContext = () => {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearchContext can only be used under a SearchProvider');
  }
  return context;
};

export const useOptionalSearchContext = () => useContext(SearchContext);

export const SearchProvider: FlowComponent = (props) => {
  const [searches, setSearches] = createSignal<Accessor<boolean>[]>([]);
  const { items } = useQuickAccessEntities(
    () => [...SEARCH_ENTITY_TYPES],
    () => '',
    () => searches().some((searching) => searching())
  );
  const routines = useQuickAccess().useList('routine').items;
  const entityPool = (searching: Accessor<boolean>) => {
    setSearches((list) => [...list, searching]);
    onCleanup(() =>
      setSearches((list) => list.filter((entry) => entry !== searching))
    );
    return items;
  };

  return (
    <SearchContext.Provider value={{ entityPool, routinePool: routines }}>
      {props.children}
    </SearchContext.Provider>
  );
};
