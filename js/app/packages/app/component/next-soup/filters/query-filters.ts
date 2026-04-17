import type { SoupItemsQueryFilters, SoupBody } from '@queries/soup/items';
import { ChannelTypeEnum } from '@service-comms/client';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { match } from 'ts-pattern';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const EXCLUDE: string[] = [NIL_UUID];

// Base filter that excludes all entity types by default
export const QUERY_FILTERS_BASE: SoupItemsQueryFilters = {
  call_filters: { channel_ids: EXCLUDE },
  channel_filters: { channel_ids: EXCLUDE },
  chat_filters: { chat_ids: EXCLUDE },
  document_filters: { document_ids: EXCLUDE },
  email_filters: { email_thread_ids: EXCLUDE },
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
      { tag: 'callRecord' },
      ({ data }) =>
        !isIdFilteredOut(body.call_filters?.channel_ids, data.channelId)
    )
    .exhaustive();
}

/** File types or associations for soup */
export const getFileAssociations = () => {
  return ['assoc:code', 'assoc:image', 'assoc:other', 'pdf'];
};

export const QUERY_FILTERS = {
  document: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { email_thread_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    document_filters: { file_types: ['md', 'canvas'] },
  },

  task: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { email_thread_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    document_filters: { sub_types: ['task'] },
  },

  email: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    email_filters: { importance: true },
  },

  people: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { email_thread_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: { channel_types: [ChannelTypeEnum.DirectMessage] },
  },

  teams: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { email_thread_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: {
      channel_types: [
        ChannelTypeEnum.Private,
        ChannelTypeEnum.Organization,
        ChannelTypeEnum.Public,
      ],
    },
  },

  agent: {
    channel_filters: { channel_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { email_thread_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    chat_filters: {},
  },

  file: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { email_thread_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    document_filters: { file_types: getFileAssociations() },
  },

  documentAndFile: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { email_thread_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    document_filters: {
      file_types: ['md', 'canvas', 'docx', ...getFileAssociations()],
    },
  },

  channels: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { email_thread_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: {},
  },

  calls: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { email_thread_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: { channel_ids: EXCLUDE },
    call_filters: {},
  },

  folders: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { email_thread_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    project_filters: {},
  },

  default: {},
} satisfies Record<string, SoupItemsQueryFilters>;
