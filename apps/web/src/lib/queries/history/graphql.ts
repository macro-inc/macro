import { readEntityAppearance } from '@app/features/entity-appearance/core/appearance';
import {
  type CacheHost,
  type RecordSelection,
  readRecordsByKeys,
  type SearchDocumentWire,
  selectRecords,
} from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import type { HistoryItemType } from '@service-storage/client';
import {
  type GraphqlChatQuickAccessNameFragment,
  GraphqlChatQuickAccessNameFragmentDoc,
  type GraphqlDocumentQuickAccessNameFragment,
  GraphqlDocumentQuickAccessNameFragmentDoc,
  type GraphqlProjectQuickAccessNameFragment,
  GraphqlProjectQuickAccessNameFragmentDoc,
  HistoryViewedAtCacheWriteDocument,
  type HistoryViewedAtCacheWriteSubscription,
  HistoryViewItemDocument,
} from '@service-storage/graphql/generated/graphql';
import { type Client, stringifyDocument } from '@urql/core';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';
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

export type HistoryTypename = (typeof HISTORY_TYPENAMES)[number];

const HISTORY_TYPENAME_BY_ITEM_TYPE: Partial<
  Record<HistoryItemType, HistoryTypename>
> = {
  document: 'GraphqlSoupDocument',
  chat: 'GraphqlSoupChat',
  project: 'GraphqlSoupProject',
};

const SOUP_ENTITY_TYPE_BY_TYPENAME = {
  GraphqlSoupDocument: 'DOCUMENT',
  GraphqlSoupChat: 'CHAT',
  GraphqlSoupProject: 'PROJECT',
} as const satisfies Record<HistoryTypename, string>;

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
  const base = {
    id,
    name: record.name,
    rawName: record.name,
    ownerId: record.ownerId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    viewedAt: record.viewedAt,
    deletedAt: null,
  };
  switch (typename) {
    case 'GraphqlSoupDocument': {
      if (record.__typename !== 'GraphqlSoupDocument') return undefined;
      if (record.subType?.__typename === 'GraphqlInitiativeDescriptionSubType')
        return undefined;
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
        appearance: readEntityAppearance(record.appearance),
        fileType: record.fileType ?? (markdown ? 'md' : undefined),
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

/** The cached record's viewedAt, null when it has none, undefined when the
 * cache holds no record history can list. */
async function cachedViewedAt(
  cacheHost: Pick<CacheHost, 'readRecordsByKeys'>,
  typename: HistoryTypename,
  id: string
): Promise<string | null | undefined> {
  const { records } = await readRecordsByKeys(
    cacheHost,
    nameSelection(typename),
    [`${typename}:${id}`]
  );
  const record = records[0]?.record;
  if (typeof record?.name !== 'string') return undefined;
  return typeof record.viewedAt === 'string' ? record.viewedAt : null;
}

const pendingStamps = new Map<string, Promise<boolean>>();

/**
 * Stamps a view on the item's cached record. Cached history is ordered by each
 * record's viewedAt, which the server's view reaches only when the cache next
 * rehydrates the item, so an item outside the cached history (never viewed, or
 * viewed long ago) would stay unlisted until then. A record the cache does not
 * hold is loaded first, and nothing is stamped if it is still missing after
 * `load`. Stamps of one record run in turn and never lower its viewedAt, so the
 * latest view wins however their loads finish. Returns whether the record holds
 * the view.
 */
export function stampCachedHistoryView(
  cacheHost: Pick<CacheHost, 'readRecordsByKeys' | 'writeQuery'>,
  view: { itemId: string; itemType: HistoryItemType; viewedAt: string },
  load: (typename: HistoryTypename) => Promise<void>
): Promise<boolean> {
  const typename = HISTORY_TYPENAME_BY_ITEM_TYPE[view.itemType];
  if (!typename) return Promise.resolve(false);
  const generation = cacheSessionGeneration.capture();
  const key = `${typename}:${view.itemId}`;
  const run = () => stampRecord(cacheHost, typename, view, load, generation);
  const stamp = (pendingStamps.get(key) ?? Promise.resolve(false)).then(
    run,
    run
  );
  pendingStamps.set(key, stamp);
  return stamp.finally(() => {
    if (pendingStamps.get(key) === stamp) pendingStamps.delete(key);
  });
}

async function stampRecord(
  cacheHost: Pick<CacheHost, 'readRecordsByKeys' | 'writeQuery'>,
  typename: HistoryTypename,
  view: { itemId: string; viewedAt: string },
  load: (typename: HistoryTypename) => Promise<void>,
  generation: string
): Promise<boolean> {
  let cached = await cachedViewedAt(cacheHost, typename, view.itemId);
  if (cached === undefined) {
    await load(typename);
    cached = await cachedViewedAt(cacheHost, typename, view.itemId);
    if (cached === undefined) return false;
  }
  if (cached !== null && Date.parse(cached) >= Date.parse(view.viewedAt))
    return true;
  await cacheHost.writeQuery({
    generation,
    query: stringifyDocument(HistoryViewedAtCacheWriteDocument),
    operationName: 'HistoryViewedAtCacheWrite',
    data: {
      soupUpdates: [
        {
          __typename: 'SoupUpdated',
          item: {
            __typename: typename,
            id: view.itemId,
            viewedAt: view.viewedAt,
          },
        },
      ],
    } satisfies HistoryViewedAtCacheWriteSubscription,
  });
  return true;
}

/** Loads one item into the cache with the fields cached history reads. */
export async function loadHistoryViewItem(
  client: Pick<Client, 'query'>,
  typename: HistoryTypename,
  id: string
): Promise<void> {
  const input = buildGraphqlEntitySoupInput(
    SOUP_ENTITY_TYPE_BY_TYPENAME[typename],
    id
  );
  if (!input) return;
  const result = await client
    .query(
      HistoryViewItemDocument,
      { input },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  if (result.error) throw result.error;
}

/** Buckets consumed by history and its hydration subscription. */
export const HISTORY_SEARCH_BUCKETS = [
  'document',
  'note',
  'task',
  'snippet',
  'skill',
  'chat',
  'project',
] as const;

/** Reads a bounded recent history through the indexed search projection, then
 * materializes only those final normalized entity keys. */
export async function readCachedGraphqlHistoryItems(
  cacheHost: Pick<CacheHost, 'search' | 'readRecordsByKeys'>
): Promise<HistoryItem[]> {
  const page = await cacheHost.search({
    profile: 'quick-access-v1',
    buckets: [...HISTORY_SEARCH_BUCKETS],
    query: '',
    limit: 500,
  });
  return materializeCachedGraphqlHistoryItems(cacheHost, page.documents);
}
