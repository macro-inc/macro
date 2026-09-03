import { useQuickAccessEntities } from '@property';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { FlowComponent } from 'solid-js';
import { SearchContext } from './context';

const SEARCH_ENTITY_TYPES = [
  EntityType.CHANNEL,
  EntityType.CHAT,
  EntityType.DOCUMENT,
  EntityType.PROJECT,
  EntityType.TASK,
] as const;

export const SearchProvider: FlowComponent = (props) => {
  const { items } = useQuickAccessEntities(() => [...SEARCH_ENTITY_TYPES]);

  return (
    <SearchContext.Provider value={{ entityPool: items }}>
      {props.children}
    </SearchContext.Provider>
  );
};
