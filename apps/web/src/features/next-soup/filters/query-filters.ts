import { soupItemMatchesTagFilter } from '@app/constants/list-views';
import type { SoupBody, SoupItemsQueryFilters } from '@queries/soup/items';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { match } from 'ts-pattern';
import { defineQueryFilters } from './filter-store/compile';
import {
  type CallStatus,
  callStatusFromAttended,
  type Query,
} from './filter-store/types';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const EXCLUDE: string[] = [NIL_UUID];

// Base filter that excludes all entity types by default
export const QUERY_FILTERS_BASE: SoupItemsQueryFilters = {
  call_filters: { call_ids: EXCLUDE },
  channel_filters: { channel_ids: EXCLUDE },
  channel_thread_filters: { thread_ids: EXCLUDE },
  chat_filters: { chat_ids: EXCLUDE },
  crm_company_filters: { company_ids: EXCLUDE },
  document_filters: { document_ids: EXCLUDE },
  email_filters: { email_thread_ids: EXCLUDE },
  foreign_entity_filters: { ids: EXCLUDE },
  project_filters: { project_ids: EXCLUDE },
};

function isIdFilteredOut(ids: string[] | undefined, value: string): boolean {
  if (!ids || ids.length === 0) return false;
  return !ids.includes(value);
}

function isValueFilteredOut(
  values: string[] | undefined,
  value: string | null | undefined
): boolean {
  if (!values || values.length === 0) return false;
  if (!value) return true;
  return !values.includes(value);
}

function isAnyValueFilteredOut(
  values: string[] | undefined,
  candidates: (string | null | undefined)[]
): boolean {
  if (!values || values.length === 0) return false;
  return !candidates.some(
    (candidate) => candidate && values.includes(candidate)
  );
}

function isAttendedFilteredOut(
  attendedFilter: boolean | null | undefined,
  itemAttended: boolean
): boolean {
  if (attendedFilter !== true && attendedFilter !== false) return false;
  return itemAttended !== attendedFilter;
}

function isCallAttendanceFilteredOut(
  statusFilter: CallStatus | null | undefined,
  attendedFilter: boolean | null | undefined,
  itemStatus: CallStatus | null | undefined,
  itemAttended: boolean
): boolean {
  if (statusFilter !== undefined && statusFilter !== null) {
    return (
      (itemStatus ?? callStatusFromAttended(itemAttended)) !== statusFilter
    );
  }

  return isAttendedFilteredOut(attendedFilter, itemAttended);
}

// TODO: this only supports the subset of soup filters needed for cache matching.
export function filterSoupItemByRequestBody(
  item: SoupApiItem,
  body: SoupBody
): boolean {
  return match(item)
    .with(
      { tag: 'document' },
      ({ data }) =>
        !isIdFilteredOut(body.document_filters?.document_ids, data.id) &&
        !isValueFilteredOut(body.document_filters?.owners, data.ownerId) &&
        !isValueFilteredOut(
          body.document_filters?.sub_types,
          data.subType?.type
        )
    )
    .with(
      { tag: 'chat' },
      ({ data }) => !isIdFilteredOut(body.chat_filters?.chat_ids, data.id)
    )
    .with(
      { tag: 'channel' },
      ({ data }) =>
        !isIdFilteredOut(body.channel_filters?.channel_ids, data.channel.id) &&
        !isAnyValueFilteredOut(body.channel_filters?.thread_ids, [
          data.latest_message?.thread_id,
          data.latest_non_thread_message?.thread_id,
        ])
    )
    .with(
      { tag: 'channelThread' },
      ({ data }) =>
        !isIdFilteredOut(body.channel_thread_filters?.thread_ids, data.id) &&
        !isIdFilteredOut(
          body.channel_thread_filters?.channel_ids,
          data.channel_id
        ) &&
        !isValueFilteredOut(
          body.channel_thread_filters?.root_sender_ids,
          data.sender_id
        )
    )
    .with(
      { tag: 'project' },
      ({ data }) => !isIdFilteredOut(body.project_filters?.project_ids, data.id)
    )
    .with(
      { tag: 'emailThread' },
      ({ data }) =>
        !isIdFilteredOut(body.email_filters?.email_thread_ids, data.id)
    )
    .with(
      { tag: 'call' },
      ({ data }) =>
        !isIdFilteredOut(body.call_filters?.call_ids, data.callId) &&
        !isCallAttendanceFilteredOut(
          body.call_filters?.status,
          body.call_filters?.attended,
          data.status,
          data.attended
        )
    )
    .with(
      { tag: 'crmCompany' },
      ({ data }) =>
        !isIdFilteredOut(body.crm_company_filters?.company_ids, data.id)
    )
    .with(
      { tag: 'foreignEntity' },
      ({ data }) =>
        !isIdFilteredOut(body.foreign_entity_filters?.ids, data.id) &&
        !isIdFilteredOut(
          body.foreign_entity_filters?.foreign_entity_ids,
          data.foreignEntityId
        ) &&
        !isValueFilteredOut(
          body.foreign_entity_filters?.foreign_entity_sources,
          data.foreignEntitySource
        )
    )
    .exhaustive();
}

/**
 * Map a filter-store {@link Query}'s `include` clause onto the request-body
 * filter shape {@link filterSoupItemByRequestBody} understands. Only the id and
 * scoping fields that matcher reads are mapped; everything else is left off (see
 * {@link soupItemMatchesQuery}).
 */
function queryIncludeToRequestBody(query: Query): SoupBody {
  const include = query.include ?? {};
  return {
    document_filters: {
      document_ids: include.documentId,
      owners: include.documentOwnerId,
      sub_types: include.subType,
    },
    chat_filters: { chat_ids: include.chatId },
    channel_filters: {
      channel_ids: include.channelId,
      thread_ids: include.channelMessageThreadId,
    },
    channel_thread_filters: {
      thread_ids: include.channelThreadId,
      root_sender_ids: include.channelThreadRootSenderId,
    },
    project_filters: { project_ids: include.folderId },
    email_filters: { email_thread_ids: include.threadId },
    call_filters: {
      call_ids: include.callId,
      status: include.callStatus,
      attended: include.callAttended,
    },
    crm_company_filters: { company_ids: include.crmCompanyId },
    foreign_entity_filters: {
      ids: include.foreignEntityRecordId,
      foreign_entity_sources: include.foreignEntitySource,
    },
  };
}

/**
 * Whether a soup item satisfies a filter-store {@link Query}, mirroring the
 * include-side entity/id/owner scoping the server AST enforces. Used to gate
 * optimistic and websocket cache inserts for queries that drive a list from a
 * raw `Query` (e.g. the dynamic-UI `list` widget) rather than a soup view.
 *
 * The query is first run through {@link defineQueryFilters}, which nil-fills the
 * id filters of every entity type the query never references — so an item whose
 * type is out of scope (e.g. a newly created task inserted into an email-scoped
 * widget) carries a real id against a `[NIL_UUID]` filter and is rejected, the
 * same way the server would never return it. An active tag filter is enforced
 * too, reusing {@link soupItemMatchesTagFilter} (the same gate the soup view
 * applies), so a newly created untagged item never leaks into a tag-scoped list.
 *
 * Refinements the server also applies but this does not — non-tag
 * properties, date ranges, seen/done, importance, `documentWhere`, `emailView`,
 * and every `exclude` clause — are treated permissively: a matching item is
 * never rejected for them, so inserts that DO belong still appear optimistically.
 */
export function soupItemMatchesQuery(item: SoupApiItem, query: Query): boolean {
  if (
    !filterSoupItemByRequestBody(
      item,
      queryIncludeToRequestBody(defineQueryFilters(query))
    )
  ) {
    return false;
  }

  const tagOptionIds = (query.include?.tagFilters ?? []).map((t) => t.value);
  return (
    tagOptionIds.length === 0 ||
    soupItemMatchesTagFilter(
      item,
      tagOptionIds,
      query.include?.tagFilterMode ?? 'any'
    )
  );
}

/**
 * Whether a soup item belongs to a given project, mirroring the parent/project
 * scoping the folder-contents soup query sends to the server: `projectId` on
 * documents and chats, `parentId` on child projects. Used to gate optimistic
 * and websocket cache inserts into a folder view so an entity created or opened
 * outside the folder never flashes into its contents before the server refetch
 * corrects it.
 *
 * Types whose soup item carries no project (emails, channels, calls, …) stay
 * permissive — membership can't be decided from the item, and an insert that
 * does belong should still appear optimistically.
 */
export function soupItemMatchesProjectMembership(
  item: SoupApiItem,
  projectId: string
): boolean {
  return match(item)
    .with({ tag: 'document' }, ({ data }) => data.projectId === projectId)
    .with({ tag: 'chat' }, ({ data }) => data.projectId === projectId)
    .with({ tag: 'project' }, ({ data }) => data.parentId === projectId)
    .otherwise(() => true);
}
