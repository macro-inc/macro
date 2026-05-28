import type { SoupBody, SoupItemsQueryFilters } from '@queries/soup/items';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { match } from 'ts-pattern';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const EXCLUDE: string[] = [NIL_UUID];

// Base filter that excludes all entity types by default
export const QUERY_FILTERS_BASE: SoupItemsQueryFilters = {
  call_filters: { call_ids: EXCLUDE },
  channel_filters: { channel_ids: EXCLUDE },
  chat_filters: { chat_ids: EXCLUDE },
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

function isAttendedFilteredOut(
  attendedFilter: boolean | null | undefined,
  itemAttended: boolean
): boolean {
  if (attendedFilter !== true && attendedFilter !== false) return false;
  return itemAttended !== attendedFilter;
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
        !isIdFilteredOut(body.channel_filters?.channel_ids, data.channel.id)
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
        !isAttendedFilteredOut(body.call_filters?.attended, data.attended)
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
