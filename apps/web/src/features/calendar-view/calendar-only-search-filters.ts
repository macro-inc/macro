import type { EntityFilters } from '@service-search/generated/models';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Restrict unified search to calendar events: every other searchable type has
 * a NIL id in its primary field, which the search service reads as "exclude
 * this type", while calendar events carry no id filter and so are the only
 * matches. This mirrors what the Search view's Calendar type produces.
 */
export const CALENDAR_ONLY_SEARCH_FILTERS: EntityFilters = {
  document_filters: { document_ids: [NIL_UUID] },
  email_filters: { email_thread_ids: [NIL_UUID] },
  channel_filters: { channel_ids: [NIL_UUID] },
  channel_thread_filters: { thread_ids: [NIL_UUID] },
  chat_filters: { chat_ids: [NIL_UUID] },
  project_filters: { project_ids: [NIL_UUID] },
  call_filters: { call_ids: [NIL_UUID] },
  foreign_entity_filters: { ids: [NIL_UUID] },
};
