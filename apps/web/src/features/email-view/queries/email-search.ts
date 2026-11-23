import {
  type FacetSelection,
  NIL_UUID,
  type SoupSearchRequest,
} from '@app/features/soup';
import type { SearchSoupQueryArgs } from '@queries/soup/search';
import type {
  EmailFilters,
  EntityFilters,
} from '@service-search/generated/models';
import { match } from 'ts-pattern';
import { EMAIL_ATTACHMENT_KINDS } from '../filters/email-facets';
import type { EmailSearchScope } from '../search/email-search-scope';
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
};

/**
 * What a search reaches. With no `in:` filter it is all mail, as the All tab
 * lists it; a view narrows it to what that view lists, its inbox views to
 * threads still in the inbox. Favorites and Focus narrow by thread id in
 * `buildEmailSearchRequest`.
 */
function scopeFilters(scope: EmailSearchScope): EmailFilters {
  return match(scope)
    .with('inbox', 'focus', () => ({ done: false }))
    .with('signal', () => ({
      importance: true,
      shared: 'exclude' as const,
      done: false,
    }))
    .with('noise', () => ({
      importance: false,
      shared: 'exclude' as const,
      done: false,
    }))
    .with('calendar', () => ({
      calendar_only: true,
      shared: 'exclude' as const,
    }))
    .with('shared', () => ({ shared: 'only' as const }))
    .with('archived', () => ({ shared: 'exclude' as const, done: true }))
    .with('sent', () => ({ view: 'sent' as const }))
    .with('drafts', () => ({ view: 'drafts' as const }))
    .with('favorites', 'all', () => ({}))
    .exhaustive();
}

/** Where a search runs: the list's own filters, and the mail it reaches. */
export type EmailSearchContext = Omit<EmailQueryContext, 'tab'> & {
  scope: EmailSearchScope;
  /** The threads a Favorites or Focus search is held to. */
  scopeThreadIds?: readonly string[];
};

const soleSelection = (selection: string[] | undefined) =>
  selection?.length === 1 ? selection[0] : undefined;

const isAttachmentOption = (
  id: string
): id is keyof typeof EMAIL_ATTACHMENT_KINDS => id in EMAIL_ATTACHMENT_KINDS;

/**
 * The read and done facets are single-select, so at most one option of each
 * reaches the service. Done is the thread being out of the inbox, as in the
 * list, not its notification state. Attachment options match a thread with
 * any of the selected kinds, as the list's attachment facet does.
 */
function facetFilters(facets: FacetSelection): Partial<EmailFilters> {
  const filters: Partial<EmailFilters> = {};
  const read = soleSelection(facets.read);
  if (read === 'unread') filters.is_read = false;
  if (read === 'read') filters.is_read = true;

  const done = soleSelection(facets.done);
  if (done === 'done') filters.done = true;
  if (done === 'not-done') filters.done = false;

  if ((facets.calendar ?? []).includes('has-calendar-invite')) {
    filters.calendar_only = true;
  }

  const attachments = [
    ...new Set(
      (facets.attachments ?? [])
        .filter(isAttachmentOption)
        .map((id) => EMAIL_ATTACHMENT_KINDS[id])
    ),
  ];
  if (attachments.length > 0) filters.attachments = attachments;

  return filters;
}

/**
 * The facet groups `buildEmailSearchRequest` sends to the service. Search hits
 * carry no attachment or invitation fields, so these must not be re-tested on
 * the client against a hit.
 */
const SERVICE_FACET_GROUPS = [
  'read',
  'done',
  'calendar',
  'attachments',
  'tags',
] as const;

/** The part of `facets` that service search leaves to the client. */
export function facetsLeftToClient(facets: FacetSelection): FacetSelection {
  const left: FacetSelection = { ...facets };
  for (const group of SERVICE_FACET_GROUPS) delete left[group];
  return left;
}

/** The service search for `context`, scoped as the list scopes the same filters. */
export function buildEmailSearchRequest(
  context: EmailSearchContext,
  search: SoupSearchRequest,
  admittedIds?: readonly string[]
): SearchSoupQueryArgs {
  // Both discovery and retained unread results stay within the view's threads.
  const threadIds =
    context.scope === 'favorites' || context.scope === 'focus'
      ? (context.scopeThreadIds ?? []).filter(
          (id) => admittedIds === undefined || admittedIds.includes(id)
        )
      : admittedIds;
  const scope = scopeFilters(context.scope);
  const facets = facetFilters(
    admittedIds ? { ...context.facets, read: [] } : context.facets
  );
  // The view and a facet are ANDed, as in the list: Archived with Not done
  // matches nothing.
  const contradicts =
    scope.done !== undefined &&
    facets.done !== undefined &&
    scope.done !== facets.done;
  const emailFilters: EmailFilters = {
    ...scope,
    ...facets,
    ...(contradicts
      ? { email_thread_ids: [NIL_UUID] }
      : threadIds
        ? { email_thread_ids: threadIds.length ? [...threadIds] : [NIL_UUID] }
        : {}),
  };

  if (context.inboxIds !== undefined) {
    // Empty `link_ids` means "any inbox" to the service, so an explicit
    // empty selection is expressed as an inbox that cannot exist.
    emailFilters.link_ids =
      context.inboxIds.length > 0 ? [...context.inboxIds] : [NIL_UUID];
  }

  // Tags are entity-wide in the search service, so they sit beside the
  // per-type filters rather than inside `email_filters`. Like the list
  // query, a selected tag that no longer exists stops filtering.
  const tagOptionIds = [...new Set(context.facets.tags ?? [])].filter((id) =>
    context.facetContext.tagPropertyDefinitionByOptionId.has(id)
  );

  return {
    params: { cursor: null, page_size: 100 },
    body: {
      query: search.query,
      match_type: search.matchType,
      search_on: 'name_content',
      filters: {
        ...nonEmailFilters,
        email_filters: emailFilters,
        ...(tagOptionIds.length > 0
          ? { tag_option_ids: tagOptionIds, tag_filter_mode: 'any' }
          : {}),
      },
    },
  };
}
