import {
  defineQueryFilters,
  NIL_UUID,
  type Query,
} from '@app/features/next-soup/filters/filter-store';

export type SearchIndexId =
  | 'channels'
  | 'document-or-file'
  | 'task'
  | 'email'
  | 'calls'
  | 'folders'
  | 'agent'
  | 'calendar';

/**
 * Server-side narrowing for each index type. `defineQueryFilters` NIL-fills
 * the id field of every target the input doesn't reference, so each seed
 * matches only its own entity type. Sub-facet values (importance, channel
 * ids, ...) are layered on top by `compileSearchQuery`.
 */
export const SEARCH_INDEX_SEEDS: Record<SearchIndexId, Query> = {
  channels: defineQueryFilters({ exclude: { channelId: [NIL_UUID] } }),
  'document-or-file': defineQueryFilters({ exclude: { subType: ['task'] } }),
  task: defineQueryFilters({ include: { subType: ['task'] } }),
  email: defineQueryFilters({}, { skipTargets: ['ef'] }),
  calls: defineQueryFilters({}, { skipTargets: ['callf'] }),
  folders: defineQueryFilters({ exclude: { folderId: [NIL_UUID] } }),
  agent: defineQueryFilters({ exclude: { chatId: [NIL_UUID] } }),
  calendar: defineQueryFilters({}, { skipTargets: ['calf'] }),
};
