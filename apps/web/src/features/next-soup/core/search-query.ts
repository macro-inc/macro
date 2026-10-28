import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  defineQueryFilters,
  NIL_UUID,
  type Query,
} from '../filters/filter-store';
import type {
  FieldFilters,
  PropertyFilter,
} from '../filters/filter-store/types';
import { getViewPreset } from '../sidebar/soup-filter-presets';
import type {
  SearchFiltersState,
  SearchIndexId,
  SearchTypeValue,
} from './search-filters';

/** Search types where tag filtering applies: documents/tasks, emails, chats,
 * calls, folders, plus the mixed `all` view (tags there narrow the taggable
 * result types and leave the rest untouched). */
export const TAG_SEARCH_TYPES = new Set<SearchTypeValue>([
  'all',
  'task',
  'document-or-file',
  'email',
  'agent',
  'calls',
  'folders',
]);

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

/**
 * Single compile path: facet state → query filters. Both data paths (soup
 * AST feed and search-service request) derive from the resulting store
 * state, so this is the only place facet semantics turn into filters.
 *
 * `'all'` compiles to just the search preset baseline — no index narrowing
 * and no email-importance bias. Only the active type's section is compiled;
 * inactive sections never constrain results.
 */
export function compileSearchQuery(state: SearchFiltersState): Query {
  const baseline = getViewPreset('search')?.filters ?? {};
  const include: FieldFilters = { ...baseline.include };
  const exclude: FieldFilters = { ...baseline.exclude };

  // Tags apply on the TAG_SEARCH_TYPES types only, so a tag filter never
  // silently empties a search narrowed to channels.
  if (TAG_SEARCH_TYPES.has(state.type) && state.tags.length) {
    include.tagFilters = state.tags;
    if (state.tagMode === 'all') {
      include.tagFilterMode = 'all';
    }
  }

  if (state.type === 'all') return { include, exclude };

  const seed = SEARCH_INDEX_SEEDS[state.type];
  Object.assign(include, seed.include);
  const excludedSubTypes = [
    ...(exclude.subType ?? []),
    ...(seed.exclude?.subType ?? []),
  ];
  Object.assign(exclude, seed.exclude);
  if (excludedSubTypes.length) exclude.subType = [...new Set(excludedSubTypes)];

  if (state.type === 'email') {
    if (state.email.importance !== undefined) {
      include.emailImportance = state.email.importance;
    }
    if (state.email.inboxIds !== undefined) {
      include.emailLinkId = state.email.inboxIds.length
        ? state.email.inboxIds
        : [NIL_UUID];
    }
  } else if (state.type === 'channels') {
    if (state.channels.in.length) include.channelId = state.channels.in;
    if (state.channels.from.length) {
      include.channelSenderId = state.channels.from;
    }
  } else if (state.type === 'calls') {
    if (state.calls.in.length) include.callChannelId = state.calls.in;
    if (state.calls.from.length) include.callSpeakerId = state.calls.from;
    if (state.calls.status !== undefined) {
      include.callStatus = state.calls.status;
    }
  } else if (state.type === 'task') {
    const properties: PropertyFilter[] = [
      ...state.task.status.map((value) => ({
        propertyId: SYSTEM_PROPERTY_IDS.STATUS,
        type: 'select' as const,
        value,
      })),
      ...state.task.priority.map((value) => ({
        propertyId: SYSTEM_PROPERTY_IDS.PRIORITY,
        type: 'select' as const,
        value,
      })),
      ...state.task.assignees.map((value) => ({
        propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
        type: 'entity' as const,
        value,
      })),
    ];
    if (properties.length) include.properties = properties;
    if (state.task.createdBy.length) {
      include.documentOwnerId = state.task.createdBy;
    }
  }

  return { include, exclude };
}
