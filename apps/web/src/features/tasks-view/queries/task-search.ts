import {
  type FacetSelection,
  NIL_UUID,
  type SoupSearchMatchType,
} from '@app/features/soup';
import { makeGraphqlFilters } from '@queries/soup/graphql/ast';
import type { SearchSoupQueryArgs } from '@queries/soup/search';
import type { EntityFilters } from '@service-search/generated/models';
import type { TaskDatePredicate } from '../core/task-due-date';
import type { TaskFacetContext } from '../filters/task-facets';
import type { TaskReferenceScope, TaskTab } from '../types';
import { buildTaskQuery } from './task-query';

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
};

export function buildTaskSearchRequest(options: {
  query: string;
  matchType: SoupSearchMatchType;
  tab: TaskTab;
  userId: string | undefined;
  facets: FacetSelection;
  facetContext?: TaskFacetContext;
  reference?: TaskReferenceScope;
  dueDate?: TaskDatePredicate;
}): SearchSoupQueryArgs {
  // Use the list's expressions rather than rebuilding membership or flattening
  // OR groups into required owner and property filters.
  const list = buildTaskQuery({
    tab: options.tab,
    userId: options.userId,
    facets: options.facets,
    facetContext: options.facetContext,
    reference: options.reference,
    dueDate: options.dueDate,
    groupBy: 'none',
    sort: [{ id: 'updated_at' }],
  });
  const { documentFilter, propertiesFilter } = makeGraphqlFilters(list.body);

  return {
    params: { cursor: null, page_size: 100 },
    body: {
      query: options.query,
      match_type: options.matchType,
      search_on: 'name_content',
      filters: {
        ...nonTaskFilters,
        document_filters: { sub_types: ['task'] },
      },
      filter_expression: { documentFilter, propertiesFilter },
    },
  };
}
