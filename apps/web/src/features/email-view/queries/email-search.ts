import {
  type FacetSelection,
  NIL_UUID,
  type SoupSearchRequest,
} from '@app/features/soup';
import type { SearchSoupQueryArgs } from '@queries/soup/search';
import type {
  EmailFilters,
  EntityFilters,
  NotificationFilters,
} from '@service-search/generated/models';
import { match } from 'ts-pattern';
import type { EmailTab } from '../types';
import type { EmailQueryContext } from './email-query';

const nonEmailFilters: EntityFilters = {
  calendar_event_filters: { calendar_event_ids: [NIL_UUID] },
  call_filters: { call_ids: [NIL_UUID] },
  channel_filters: { channel_ids: [NIL_UUID] },
  channel_thread_filters: { thread_ids: [NIL_UUID] },
  chat_filters: { chat_ids: [NIL_UUID] },
  crm_company_filters: { company_ids: [NIL_UUID] },
  document_filters: { document_ids: [NIL_UUID] },
  foreign_entity_filters: { ids: [NIL_UUID] },
  project_filters: { project_ids: [NIL_UUID] },
  reminder_filters: { ids: [NIL_UUID] },
};

// Search has no draft/sent scoping, so those tabs (like All) search the
// user's own threads — the same reach the legacy mail search had.
function tabFilters(tab: EmailTab): EmailFilters {
  return match(tab)
    .with('important', () => ({ importance: true, shared: 'exclude' as const }))
    .with('noise', () => ({ importance: false, shared: 'exclude' as const }))
    .with('calendar', () => ({
      calendar_only: true,
      shared: 'exclude' as const,
    }))
    .with('shared', () => ({ shared: 'only' as const }))
    .with('drafts', 'sent', 'all', () => ({}))
    .exhaustive();
}

const soleSelection = (selection: string[] | undefined) =>
  selection?.length === 1 ? selection[0] : undefined;

/**
 * The read and done facets are single-select, so at most one option of each
 * reaches the service. Attachment facets have no service counterpart; those
 * refine the results client-side like the list page.
 */
function facetFilters(facets: FacetSelection): Partial<EmailFilters> {
  const filters: Partial<EmailFilters> = {};
  const notification: NotificationFilters = {};

  const read = soleSelection(facets.read);
  if (read === 'unread') notification.seen = false;
  if (read === 'read') notification.seen = true;

  const done = soleSelection(facets.done);
  if (done === 'not-done') notification.done = false;
  if (done === 'done') notification.done = true;

  if (Object.keys(notification).length > 0) {
    filters.notification_filters = notification;
  }

  if ((facets.calendar ?? []).includes('has-calendar-invite')) {
    filters.calendar_only = true;
  }

  return filters;
}

/** Mirrors the Email view's tab, inbox, and facet scoping for service-backed search. */
export function buildEmailSearchRequest(
  context: EmailQueryContext,
  search: SoupSearchRequest
): SearchSoupQueryArgs {
  const emailFilters: EmailFilters = {
    ...tabFilters(context.tab),
    ...facetFilters(context.facets),
  };

  if (context.inboxIds !== undefined) {
    // Empty `link_ids` means "any inbox" to the service, so an explicit
    // empty selection is expressed as an inbox that cannot exist.
    emailFilters.link_ids =
      context.inboxIds.length > 0 ? [...context.inboxIds] : [NIL_UUID];
  }

  return {
    params: { cursor: null, page_size: 100 },
    body: {
      query: search.query,
      match_type: search.matchType,
      search_on: 'name_content',
      filters: { ...nonEmailFilters, email_filters: emailFilters },
    },
  };
}
