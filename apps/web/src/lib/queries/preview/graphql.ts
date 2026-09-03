import {
  type CacheHost,
  readRecordsByKeys,
  selectRecords,
} from '@app/lib/graphql-cache';
import { createUrqlQuery } from '@app/lib/urql-solid';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { DEFAULT_ITEM_TYPE, type ItemType } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import {
  ItemPreviewDocument,
  type ItemPreviewFieldsFragment,
  ItemPreviewFieldsFragmentDoc,
  type ItemPreviewQuery,
  type ItemPreviewQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type { Accessor } from 'solid-js';
import { createEffect, createSignal } from 'solid-js';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';
import type { ItemEntity, PreviewItem } from './types';

const previewSelection = selectRecords(ItemPreviewFieldsFragmentDoc);

const GRAPHQL_TYPENAMES = {
  call: 'GraphqlSoupCall',
  channel: 'GraphqlSoupChannel',
  chat: 'GraphqlSoupChat',
  crm_company: 'GraphqlSoupCrmCompany',
  document: 'GraphqlSoupDocument',
  email: 'GraphqlSoupEmailThread',
  project: 'GraphqlSoupProject',
} as const;

type GraphqlPreviewType = keyof typeof GRAPHQL_TYPENAMES;

function normalizedItemType(item: ItemEntity): ItemType {
  return item.type ?? DEFAULT_ITEM_TYPE;
}

function graphqlEntityType(type: GraphqlPreviewType): EntityType {
  switch (type) {
    case 'document':
      return 'DOCUMENT';
    case 'chat':
      return 'CHAT';
    case 'project':
      return 'PROJECT';
    case 'email':
      return 'THREAD';
    case 'channel':
      return 'CHANNEL';
    case 'call':
      return 'CALL_RECORD';
    case 'crm_company':
      return 'COMPANY';
  }
}

export function isGraphqlPreviewItem(
  item: ItemEntity
): item is ItemEntity & { type?: GraphqlPreviewType } {
  const type = normalizedItemType(item);
  return (
    type in GRAPHQL_TYPENAMES &&
    !(item.type === 'channel' && item.messageId !== undefined)
  );
}

function normalizedRecordKey(item: ItemEntity): string | undefined {
  if (!isGraphqlPreviewItem(item)) return undefined;
  const type = normalizedItemType(item) as GraphqlPreviewType;
  return `${GRAPHQL_TYPENAMES[type]}:${item.id}`;
}

function itemPreviewInput(item: ItemEntity) {
  if (!isGraphqlPreviewItem(item)) return undefined;
  const type = normalizedItemType(item) as GraphqlPreviewType;
  return buildGraphqlEntitySoupInput(graphqlEntityType(type), item.id);
}

function documentSubType(
  subType: Extract<
    ItemPreviewFieldsFragment,
    { __typename: 'GraphqlSoupDocument' }
  >['subType']
) {
  if (!subType) return undefined;
  switch (subType.__typename) {
    case 'GraphqlTaskSubType':
      return { type: 'task' as const, is_completed: subType.isCompleted };
    case 'GraphqlSnippetSubType':
      return { type: 'snippet' as const };
    case 'GraphqlSkillSubType':
      return { type: 'skill' as const };
  }
}

export function graphqlRecordToPreview(
  record: ItemPreviewFieldsFragment
): PreviewItem | undefined {
  switch (record.__typename) {
    case 'GraphqlSoupDocument':
      return {
        id: record.id,
        type: 'document',
        access: 'access',
        loading: false,
        rawName: record.displayName ?? record.documentName,
        name: record.displayName ?? record.documentName,
        fileType: (record.fileType ?? undefined) as FileType | undefined,
        owner: record.ownerId,
        updatedAt: record.updatedAt,
        subType: documentSubType(record.subType),
      };
    case 'GraphqlSoupChat':
      return {
        id: record.id,
        type: 'chat',
        access: 'access',
        loading: false,
        rawName: record.displayName ?? record.chatName,
        name: record.displayName ?? record.chatName,
        owner: record.ownerId,
        updatedAt: record.updatedAt,
      };
    case 'GraphqlSoupProject':
      return {
        id: record.id,
        type: 'project',
        access: 'access',
        loading: false,
        rawName: record.displayName ?? record.projectName,
        name: record.displayName ?? record.projectName,
        owner: record.ownerId,
        updatedAt: record.updatedAt,
      };
    case 'GraphqlSoupEmailThread': {
      const name = record.displayName ?? record.emailName ?? 'No Subject';
      return {
        id: record.id,
        type: 'email',
        access: 'access',
        loading: false,
        rawName: name,
        name,
        owner: record.senderEmail ?? record.senderName ?? record.ownerId,
        updatedAt: record.updatedAt,
      };
    }
    case 'GraphqlSoupChannel': {
      const name = record.displayName ?? record.channelDisplayName;
      if (
        record.channelType.toLowerCase() === 'direct_message' &&
        name == null
      ) {
        return undefined;
      }
      return {
        id: record.id,
        type: 'channel',
        access: 'access',
        loading: false,
        rawName: name ?? '',
        name: name ?? '',
        channelType: record.channelType.toLowerCase() as Extract<
          PreviewItem,
          { type: 'channel'; access: 'access' }
        >['channelType'],
      };
    }
    case 'GraphqlSoupCall': {
      const name = record.customName ?? record.channelName ?? '';
      return {
        id: record.id,
        type: 'call',
        access: 'access',
        loading: false,
        rawName: name,
        name: name || 'Unknown Call',
        updatedAt: record.startedAt,
      };
    }
    case 'GraphqlSoupCrmCompany': {
      const name =
        record.displayName ??
        record.companyName ??
        record.domains[0] ??
        'Unknown Company';
      return {
        id: record.id,
        type: 'crm_company',
        access: 'access',
        loading: false,
        rawName: name,
        name,
        updatedAt: record.updatedAt,
      };
    }
    default:
      return undefined;
  }
}

function previewFromQuery(
  data: ItemPreviewQuery,
  item: ItemEntity
): PreviewItem | undefined {
  const record = data.user.soup.items.find(({ id }) => id === item.id);
  return record ? graphqlRecordToPreview(record) : undefined;
}

export async function readCachedGraphqlItemPreviewFromHost(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  item: ItemEntity
): Promise<PreviewItem | undefined> {
  const recordKey = normalizedRecordKey(item);
  if (!recordKey) return undefined;
  const result = await readRecordsByKeys(host, previewSelection, [recordKey]);
  const record = result.records[0]?.record;
  return record ? graphqlRecordToPreview(record) : undefined;
}

export async function readCachedGraphqlItemPreview(
  item: ItemEntity
): Promise<PreviewItem | undefined> {
  const host = getGraphqlSoupCacheHost();
  return host
    ? readCachedGraphqlItemPreviewFromHost(host, item)
    : Promise.resolve(undefined);
}

/** One-shot GraphQL preview lookup for non-reactive consumers. */
export async function getGraphqlItemPreview(
  item: ItemEntity
): Promise<PreviewItem | undefined> {
  const cached = await readCachedGraphqlItemPreview(item);
  if (cached) return cached;
  const input = itemPreviewInput(item);
  if (!input) return undefined;
  const result = await getGraphqlSoupClient()
    .query<ItemPreviewQuery, ItemPreviewQueryVariables>(
      ItemPreviewDocument,
      { input },
      { requestPolicy: 'cache-first' }
    )
    .toPromise();
  if (result.error) throw result.error;
  return result.data ? previewFromQuery(result.data, item) : undefined;
}

export type GraphqlItemPreviewQuery = {
  data: Accessor<PreviewItem | undefined>;
  error: Accessor<Error | null>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  isEnabled: Accessor<boolean>;
  shouldFallback: Accessor<boolean>;
  refetch: () => Promise<void>;
};

/** Creates a live urql-solid preview query and seeds it from keyed records. */
export function createGraphqlItemPreviewQuery(
  item: Accessor<ItemEntity>,
  enabled: Accessor<boolean>
): GraphqlItemPreviewQuery {
  const [cached, setCached] = createSignal<
    { recordKey: string; preview: PreviewItem | undefined } | undefined
  >();
  let cacheRequest = 0;

  createEffect(() => {
    const current = item();
    const recordKey = normalizedRecordKey(current);
    if (!enabled() || !recordKey) {
      cacheRequest += 1;
      setCached(undefined);
      return;
    }
    const request = ++cacheRequest;
    void readCachedGraphqlItemPreview(current)
      .then((preview) => {
        if (request === cacheRequest) setCached({ recordKey, preview });
      })
      .catch(() => undefined);
  });

  const result = createUrqlQuery<
    ItemPreviewQuery,
    ItemPreviewQueryVariables,
    PreviewItem | undefined
  >(() => {
    const current = item();
    const input = itemPreviewInput(current);
    const client = getGraphqlSoupClient();
    if (!enabled() || !input) {
      return { query: ItemPreviewDocument, client, enabled: false };
    }
    return {
      query: ItemPreviewDocument,
      client,
      variables: { input },
      requestPolicy: 'cache-first',
      keepPreviousData: false,
      select: (data) => previewFromQuery(data, current),
    };
  });

  const cachedPreview = () => {
    const current = cached();
    if (!current || current.recordKey !== normalizedRecordKey(item())) {
      return undefined;
    }
    return current.preview;
  };
  const data = () => result.data ?? cachedPreview();
  const shouldFallback = () =>
    isGraphqlPreviewItem(item()) &&
    ((result.isError &&
      (result.error?.networkError == null || cachedPreview() === undefined)) ||
      (result.isFetched && !result.isFetching && result.data === undefined));

  return {
    data,
    error: () => result.error,
    isLoading: () => result.isLoading,
    isFetching: () => result.isFetching,
    isEnabled: () => result.isEnabled,
    shouldFallback,
    refetch: async () => {
      await result.refetch({ requestPolicy: 'network-only' });
    },
  };
}
