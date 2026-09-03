import type { EntityData } from '@entity';
import type { EntityTypeItemMap } from '@property';
import { type Accessor, createContext, useContext } from 'solid-js';

type SearchEntityType = 'CHANNEL' | 'CHAT' | 'DOCUMENT' | 'PROJECT' | 'TASK';

export type SoupSearchPoolItem = EntityTypeItemMap[SearchEntityType];

export type SoupSearchPoolEntry = {
  data: EntityData;
  bucket?: string;
};

export interface SearchContextValue {
  entityPool: Accessor<SoupSearchPoolEntry[]>;
}

const EMPTY_POOL: SoupSearchPoolEntry[] = [];

export const SearchContext = createContext<SearchContextValue>({
  entityPool: () => EMPTY_POOL,
});

export const useSearchContext = () => useContext(SearchContext);

export const useOptionalSearchContext = () => useContext(SearchContext);
