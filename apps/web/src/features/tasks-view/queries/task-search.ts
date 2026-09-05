import {
  type FacetSelection,
  NIL_UUID,
  type SoupSearchMatchType,
} from '@app/features/soup';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { SearchSoupQueryArgs } from '@queries/soup/search';
import type {
  EntityFilters,
  PropertyFilter as SearchPropertyFilter,
} from '@service-search/generated/models';
import {
  EMPTY_TASK_FACET_CONTEXT,
  getTaskFacetOption,
  type TaskFacetContext,
} from '../filters/task-facets';
import type { TaskTab } from '../types';

const nonTaskFilters: EntityFilters = {
  calendar_event_filters: { calendar_event_ids: [NIL_UUID] },
  call_filters: { call_ids: [NIL_UUID] },
  channel_filters: { channel_ids: [NIL_UUID] },
  channel_thread_filters: { thread_ids: [NIL_UUID] },
  chat_filters: { chat_ids: [NIL_UUID] },
  crm_company_filters: { company_ids: [NIL_UUID] },
  email_filters: { email_thread_ids: [NIL_UUID] },
  foreign_entity_filters: { ids: [NIL_UUID] },
  project_filters: { project_ids: [NIL_UUID] },
  reminder_filters: { ids: [NIL_UUID] },
};

const selectedCreators = (
  selection: FacetSelection,
  tab: TaskTab,
  userId: string | undefined
): string[] | undefined => {
  const selected = [...new Set(selection['created-by'] ?? [])];
  if (tab !== 'created-by-me') {
    return selected.length > 0 ? selected : undefined;
  }
  if (!userId) return [NIL_UUID];
  if (selected.length > 0 && !selected.includes(userId)) return [NIL_UUID];
  return [userId];
};

const selectedPropertyFilters = (
  selection: FacetSelection,
  context: TaskFacetContext
): SearchPropertyFilter[] =>
  Object.entries(selection).flatMap(([facetId, optionIds]) => {
    if (facetId === 'created-by' || facetId === 'tags') return [];

    const resolved = optionIds.flatMap((optionId) => {
      const option = getTaskFacetOption(facetId, optionId, context);
      return option ? [option] : [];
    });
    const propertyDefinitionId = resolved[0]?.propertyDefinitionId;
    if (!propertyDefinitionId) return [];

    const optionIdsForProperty = resolved.flatMap((option) =>
      option.propertyOptionId ? [option.propertyOptionId] : []
    );
    const entityIdsForProperty = resolved.flatMap((option) =>
      option.propertyEntityId ? [option.propertyEntityId] : []
    );

    return [
      {
        property_definition_id: propertyDefinitionId,
        entity_type: 'TASK',
        ...(optionIdsForProperty.length > 0
          ? { option_ids: optionIdsForProperty }
          : {}),
        ...(entityIdsForProperty.length > 0
          ? { entity_ids: entityIdsForProperty }
          : {}),
      },
    ];
  });

export function buildTaskSearchRequest(options: {
  query: string;
  matchType: SoupSearchMatchType;
  tab: TaskTab;
  userId: string | undefined;
  facets: FacetSelection;
  facetContext?: TaskFacetContext;
}): SearchSoupQueryArgs {
  const propertyFilters = selectedPropertyFilters(
    options.facets,
    options.facetContext ?? EMPTY_TASK_FACET_CONTEXT
  );

  if (options.tab === 'my-tasks') {
    propertyFilters.push({
      property_definition_id: SYSTEM_PROPERTY_IDS.ASSIGNEES,
      entity_type: 'TASK',
      entity_ids: [options.userId ?? NIL_UUID],
    });
  }

  const owners = selectedCreators(options.facets, options.tab, options.userId);
  const tagOptionIds = [...new Set(options.facets.tags ?? [])];

  return {
    params: { cursor: null, page_size: 100 },
    body: {
      query: options.query,
      match_type: options.matchType,
      search_on: 'name_content',
      filters: {
        ...nonTaskFilters,
        document_filters: {
          sub_types: ['task'],
          ...(owners ? { owners } : {}),
        },
        ...(propertyFilters.length > 0
          ? { property_filters: propertyFilters }
          : {}),
        ...(tagOptionIds.length > 0
          ? { tag_option_ids: tagOptionIds, tag_filter_mode: 'any' }
          : {}),
      },
    },
  };
}
