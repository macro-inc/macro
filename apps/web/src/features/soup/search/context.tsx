import { useQuickAccess } from '@core/context/quickAccess';
import type { EntityData } from '@entity';
import { type EntityTypeItemMap, useQuickAccessEntities } from '@property';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  type Accessor,
  createContext,
  createMemo,
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
   * whose `searching` is true while its search has text. Call it once while
   * setting up; `searching` reads plain signals only. The pool always lists
   * its in-memory rows, but adds cache rows, and rereads the cache on every
   * cache change, only while some caller is searching.
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

type PoolHold = { searching: Accessor<boolean> };

export const SearchProvider: FlowComponent = (props) => {
  const [holds, setHolds] = createSignal<PoolHold[]>([]);
  // Only the flip matters: the list's effects would otherwise rerun, and
  // replay the cache browse, on every keystroke of every search. The in-memory
  // rows stay enabled so the first keystroke finds them already built.
  const anySearching = createMemo(() =>
    holds().some((hold) => hold.searching())
  );
  const { items } = useQuickAccessEntities(
    () => [...SEARCH_ENTITY_TYPES],
    () => '',
    () => true,
    undefined,
    anySearching
  );
  const routines = useQuickAccess().useList('routine').items;
  const entityPool = (searching: Accessor<boolean>) => {
    const hold = { searching };
    setHolds((list) => [...list, hold]);
    onCleanup(() => setHolds((list) => list.filter((entry) => entry !== hold)));
    return items;
  };

  return (
    <SearchContext.Provider value={{ entityPool, routinePool: routines }}>
      {props.children}
    </SearchContext.Provider>
  );
};
