import type { EntityFilters } from '../../../generated/search/types.gen';
import type { SearchType } from './types';

const nil = '00000000-0000-0000-0000-000000000000';

/** How each kind is left out of a search: a nil id in its primary filter. */
export const exclusions: Record<
  Exclude<SearchType, 'company'>,
  (filters: EntityFilters) => EntityFilters
> = {
  agent_session: (f) => ({
    ...f,
    agent_session_filters: { ...f.agent_session_filters, ids: [nil] },
  }),
  document: (f) => ({ ...f, document_filters: { document_ids: [nil] } }),
  chat: (f) => ({ ...f, chat_filters: { chat_ids: [nil] } }),
  email: (f) => ({
    ...f,
    email_filters: { ...f.email_filters, email_thread_ids: [nil] },
  }),
  channel: (f) => ({ ...f, channel_filters: { channel_ids: [nil] } }),
  project: (f) => ({ ...f, project_filters: { project_ids: [nil] } }),
  call: (f) => ({ ...f, call_filters: { channel_ids: [nil] } }),
  calendar_event: (f) => ({
    ...f,
    calendar_event_filters: { calendar_event_ids: [nil] },
  }),
};

/** Filters that leave every kind but `type` out of a unified search. */
export function onlyType(
  type: Exclude<SearchType, 'company'>,
  filters: EntityFilters = {},
): EntityFilters {
  let scoped = filters;
  for (const [kind, exclude] of Object.entries(exclusions))
    if (kind !== type) scoped = exclude(scoped);
  return scoped;
}
