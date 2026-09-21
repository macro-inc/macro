import {
  clause,
  compileClause,
  confine,
  NIL_UUID,
} from '@app/features/soup/filters';
import type { SoupSearchRequest } from '@app/features/soup/search';
import type { SoupAstItemsQueryArgs } from '@queries/soup/items';
import type { SearchSoupQueryArgs } from '@queries/soup/search';
import type { EntityFilters } from '@service-search/generated/models';

/** Every non-call type is pinned to an id that cannot exist. */
function excludedNonCallFilters(): EntityFilters {
  return {
    agent_session_filters: { ids: [NIL_UUID] },
    calendar_event_filters: { calendar_event_ids: [NIL_UUID] },
    channel_filters: { channel_ids: [NIL_UUID] },
    channel_thread_filters: { thread_ids: [NIL_UUID] },
    chat_filters: { chat_ids: [NIL_UUID] },
    crm_company_filters: { company_ids: [NIL_UUID] },
    document_filters: { document_ids: [NIL_UUID] },
    email_filters: { email_thread_ids: [NIL_UUID] },
    foreign_entity_filters: { ids: [NIL_UUID] },
    project_filters: { project_ids: [NIL_UUID] },
    reminder_filters: { ids: [NIL_UUID] },
  };
}

/** Soup AST for the calls recorded in a single channel. */
export function buildChannelCallsQuery(
  channelId: string
): SoupAstItemsQueryArgs {
  return {
    params: {
      expand: true,
      limit: 100,
      sort_method: 'updated_at',
      sort_direction: 'desc',
    },
    body: compileClause(
      confine({
        callf: clause.eq('callChannelId', channelId),
      })
    ),
  };
}

/** Name and transcript search for the calls recorded in one channel. */
export function buildChannelCallsSearchRequest(
  channelId: string,
  search: SoupSearchRequest
): SearchSoupQueryArgs {
  return {
    params: { cursor: null, page_size: 100 },
    body: {
      query: search.query,
      match_type: search.matchType,
      search_on: 'name_content',
      filters: {
        ...excludedNonCallFilters(),
        call_filters: { channel_ids: [channelId] },
      },
    },
  };
}
