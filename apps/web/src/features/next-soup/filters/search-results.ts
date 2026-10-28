import type { EntityData } from '@entity';
import type { SearchTypeValue } from '../core/search-filters';
import { SOUP_FILTERS } from './configs';
import { NIL_UUID, type Query } from './filter-store';
import { searchSupportedFilter } from './predicates';

/** Client-side Search scope for fields the full-text API cannot exclude. */
export function createSearchResultFilter(type: SearchTypeValue, query: Query) {
  const predicate = SOUP_FILTERS.find(
    (filter) => filter.id === type
  )?.predicate;
  const excludedSubTypes = new Set(query.exclude?.subType ?? []);
  return (entity: EntityData): boolean => {
    if (!searchSupportedFilter(entity)) return false;
    if (
      entity.type === 'document' &&
      entity.subType &&
      excludedSubTypes.has(entity.subType.type)
    )
      return false;
    if (
      entity.type === 'calendar_event' &&
      query.include?.calendarEventId?.includes(NIL_UUID)
    )
      return false;
    if (
      entity.type === 'channel_thread' &&
      query.include?.channelThreadId?.includes(NIL_UUID)
    )
      return false;
    return type === 'all' || predicate?.(entity, {}) === true;
  };
}
