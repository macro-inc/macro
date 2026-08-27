import {
  type CacheHost,
  type RecordSelection,
  readRecordsByKeys,
  type SearchDocumentWire,
  selectRecords,
} from '@graphql-cache/index';
import {
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
      for (const { recordKey, record } of records.records) {
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
