import { codeFileExtensions } from '@block-code/util/languageSupport';
import type { SoupItemsQueryFilters, SoupBody } from '@queries/soup/items';
import { ChannelTypeEnum } from '@service-comms/client';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { match } from 'ts-pattern';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const EXCLUDE: string[] = [NIL_UUID];

/** Base filter that excludes all entity types by default */
export const QUERY_FILTERS_BASE: SoupItemsQueryFilters = {
  channel_filters: { channel_ids: EXCLUDE },
  chat_filters: { chat_ids: EXCLUDE },
  document_filters: { document_ids: EXCLUDE },
  email_filters: { recipients: EXCLUDE },
  project_filters: { project_ids: EXCLUDE },
};

function isIdFilteredOut(ids: string[] | undefined, value: string): boolean {
  if (!ids || ids.length === 0) return false;
  return !ids.includes(value);
}

//  TODO: this only supports for item type and id filters, other filters to be added later
export function filterSoupItemByRequestBody(
  item: SoupApiItem,
  body: SoupBody
): boolean {
  return match(item)
    .with(
      { tag: 'document' },
      ({ data }) =>
        !isIdFilteredOut(body.document_filters?.document_ids, data.id)
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
    .exhaustive();
}

export const FILE_ASSOCIATION_TYPES = [
  'code',
  'image',
  'pdf',
  'unknown',
] as const;

/** Expands file association types to file extensions for soup or search */
export const getFileAssociations = (type: 'soup' | 'search') => {
  return FILE_ASSOCIATION_TYPES.flatMap((fileType) => {
    if (fileType === 'code')
      return type === 'soup' ? ['assoc:code'] : codeFileExtensions;
    if (fileType === 'image')
      return type === 'soup' ? ['assoc:image'] : [NIL_UUID];
    if (fileType === 'unknown')
      return type === 'soup' ? ['assoc:other'] : [NIL_UUID];
    return [fileType];
  });
};

export const QUERY_FILTERS = {
  /** Docs filter - markdown and canvas documents (excludes tasks) */
  document: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    document_filters: { file_types: ['md', 'canvas'] },
  },

  /** Tasks filter - markdown documents with task subType */
  task: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    document_filters: { file_types: ['md'] },
  },

  /** Mail filter - emails */
  email: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    email_filters: {},
  },

  /** People filter - direct message channels */
  people: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: { channel_types: [ChannelTypeEnum.DirectMessage] },
  },

  /** Teams filter - group channels (non-DM) */
  teams: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: {
      channel_types: [
        ChannelTypeEnum.Private,
        ChannelTypeEnum.Organization,
        ChannelTypeEnum.Public,
      ],
    },
  },

  /** Agents filter - chats */
  agent: {
    channel_filters: { channel_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    chat_filters: {},
  },

  /** Files filter - non-markdown documents (code, images, pdfs, etc.) */
  file: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    document_filters: { file_types: getFileAssociations('soup') },
  },

  /** Channels filter - all channels (teams and people) */
  channels: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: {},
  },

  /** Default - include all entity types (no filter active) */
  default: {},
} satisfies Record<string, SoupItemsQueryFilters>;

export type QueryFilterKey = keyof typeof QUERY_FILTERS;
