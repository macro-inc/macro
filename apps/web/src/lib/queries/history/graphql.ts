import {
  type CacheHost,
  type RecordSelection,
  readRecordsByKeys,
  type SearchDocumentWire,
  selectRecords,
} from '@graphql-cache/index';
import {
  type GraphqlChannelQuickAccessFieldsFragment,
  GraphqlChannelQuickAccessFieldsFragmentDoc,
  type GraphqlChatQuickAccessNameFragment,
  GraphqlChatQuickAccessNameFragmentDoc,
  type GraphqlDocumentQuickAccessNameFragment,
  GraphqlDocumentQuickAccessNameFragmentDoc,
  type GraphqlProjectQuickAccessNameFragment,
  GraphqlProjectQuickAccessNameFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import type { HistoryItem } from './types';

type NameProjection =
  | GraphqlDocumentQuickAccessNameFragment
  | GraphqlChatQuickAccessNameFragment
  | GraphqlProjectQuickAccessNameFragment;

const HISTORY_TYPENAMES = [
  'GraphqlSoupDocument',
  'GraphqlSoupChat',
  'GraphqlSoupProject',
] as const;

type HistoryTypename = (typeof HISTORY_TYPENAMES)[number];

/** Minimal cached GraphQL channel fields used by Quick Access. */
export type CachedGraphqlChannel = {
  id: string;
  name: string;
  ownerId: string;
  channelType: 'direct_message' | 'private' | 'public' | 'team';
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
  viewedAt?: string;
  interactedAt?: string;
};

function normalizeChannelType(
  channelType: string
): CachedGraphqlChannel['channelType'] {
  switch (channelType.toLowerCase()) {
    case 'direct_message':
      return 'direct_message';
    case 'private':
      return 'private';
    case 'team':
      return 'team';
    default:
      return 'public';
  }
}

function nameSelection(
  typename: HistoryTypename
): RecordSelection<NameProjection> {
  switch (typename) {
    case 'GraphqlSoupDocument':
      return selectRecords(GraphqlDocumentQuickAccessNameFragmentDoc);
    case 'GraphqlSoupChat':
      return selectRecords(GraphqlChatQuickAccessNameFragmentDoc);
    case 'GraphqlSoupProject':
      return selectRecords(GraphqlProjectQuickAccessNameFragmentDoc);
  }
}

function historyItemFromSearchDocument(
  document: SearchDocumentWire,
  record: NameProjection
): HistoryItem | undefined {
  const separator = document.recordKey.indexOf(':');
  if (separator < 0) return undefined;
  const typename = document.recordKey.slice(0, separator);
  const id = document.recordKey.slice(separator + 1);
  const date = new Date(document.timestampMs);
  const updatedAt = Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
  const base = {
    id,
    name: record.name,
    rawName: record.name,
    ownerId: record.ownerId,
    createdAt: record.createdAt,
    updatedAt,
    deletedAt: null,
  };
  switch (typename) {
    case 'GraphqlSoupDocument': {
      if (record.__typename !== 'GraphqlSoupDocument') return undefined;
      const markdown = document.bucket !== 'document';
      const subType =
        document.bucket === 'task' ||
        document.bucket === 'snippet' ||
        document.bucket === 'skill'
          ? {
              type: document.bucket,
              ...(document.bucket === 'task'
                ? {
                    is_completed:
                      record.subType?.__typename === 'GraphqlTaskSubType'
                        ? record.subType.isCompleted
                        : undefined,
                  }
                : {}),
            }
          : null;
      return {
        ...base,
        type: 'document',
        fileType: markdown ? 'md' : undefined,
        subType,
      } as HistoryItem;
    }
    case 'GraphqlSoupChat':
      return { ...base, type: 'chat', isPersistent: true };
    case 'GraphqlSoupProject':
      return { ...base, type: 'project' };
    default:
      return undefined;
  }
}

/** Materializes only the supplied compact document/chat/project search hits. */
export async function materializeCachedGraphqlHistoryItems(
  cacheHost: Pick<CacheHost, 'readRecordsByKeys'>,
  documents: SearchDocumentWire[]
): Promise<HistoryItem[]> {
  const supported = documents.filter((document) =>
    /^(GraphqlSoupDocument|GraphqlSoupChat|GraphqlSoupProject):/.test(
      document.recordKey
    )
  );
  const recordsByKey = new Map<string, NameProjection>();
  await Promise.all(
    HISTORY_TYPENAMES.map(async (typename) => {
      const keys = supported
        .filter((document) => document.recordKey.startsWith(`${typename}:`))
        .map((document) => document.recordKey);
      if (keys.length === 0) return;
      const records = await readRecordsByKeys(
        cacheHost,
        nameSelection(typename),
        keys
      );
      for (const { recordKey, record } of records) {
        recordsByKey.set(recordKey, record);
      }
    })
  );

  return supported.flatMap((document) => {
    const record = recordsByKey.get(document.recordKey);
    const item = record
      ? historyItemFromSearchDocument(document, record)
      : undefined;
    return item ? [item] : [];
  });
}

/** Materializes supplied cached GraphQL channel search hits. */
export async function materializeCachedGraphqlChannels(
  cacheHost: Pick<CacheHost, 'readRecordsByKeys'>,
  documents: SearchDocumentWire[]
): Promise<CachedGraphqlChannel[]> {
  const channelDocuments = documents.filter((document) =>
    document.recordKey.startsWith('GraphqlSoupChannel:')
  );
  if (channelDocuments.length === 0) return [];

  const records = await readRecordsByKeys(
    cacheHost,
    selectRecords(GraphqlChannelQuickAccessFieldsFragmentDoc),
    channelDocuments.map((document) => document.recordKey)
  );

  return records.flatMap(({ recordKey, record }) => {
    const channel = record as GraphqlChannelQuickAccessFieldsFragment;
    if (channel.__typename !== 'GraphqlSoupChannel') return [];
    const separator = recordKey.indexOf(':');
    if (separator < 0) return [];

    return [
      {
        id: recordKey.slice(separator + 1),
        name: channel.name ?? '',
        ownerId: channel.ownerId,
        channelType: normalizeChannelType(channel.channelType),
        participantIds: channel.participants.map(({ userId }) => userId),
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt,
        viewedAt: channel.viewedAt ?? undefined,
        interactedAt: channel.interactedAt ?? undefined,
      },
    ];
  });
}

/** Reads the bounded recent channel list used for empty Quick Access menus. */
export async function readCachedGraphqlChannels(
  cacheHost: Pick<CacheHost, 'search' | 'readRecordsByKeys'>,
  limit = 50
): Promise<CachedGraphqlChannel[]> {
  const page = await cacheHost.search({
    profile: 'quick-access-v1',
    buckets: ['channel', 'dm'],
    query: '',
    limit,
  });
  return materializeCachedGraphqlChannels(cacheHost, page.documents);
}

/** Reads a bounded recent history through the indexed search projection, then
 * materializes only those final normalized entity keys. */
export async function readCachedGraphqlHistoryItems(
  cacheHost: Pick<CacheHost, 'search' | 'readRecordsByKeys'>
): Promise<HistoryItem[]> {
  const page = await cacheHost.search({
    profile: 'quick-access-v1',
    buckets: [
      'document',
      'note',
      'task',
      'snippet',
      'skill',
      'chat',
      'project',
    ],
    query: '',
    limit: 500,
  });
  return materializeCachedGraphqlHistoryItems(cacheHost, page.documents);
}
