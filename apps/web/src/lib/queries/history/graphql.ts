import { itemToSafeName } from '@core/constant/allBlocks';
import {
  type CacheHost,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  type RecordSelection,
  readRecords,
  selectRecords,
} from '@graphql-cache/index';
import {
  type GraphqlChatHistoryFieldsFragment,
  GraphqlChatHistoryFieldsFragmentDoc,
  type GraphqlDocumentHistoryFieldsFragment,
  GraphqlDocumentHistoryFieldsFragmentDoc,
  type GraphqlProjectHistoryFieldsFragment,
  GraphqlProjectHistoryFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import { formatDocumentName } from '@service-storage/util/filename';
import type { DocumentHistoryItem, HistoryItem } from './types';

const graphqlDocumentHistorySelection = selectRecords(
  GraphqlDocumentHistoryFieldsFragmentDoc
);
const graphqlChatHistorySelection = selectRecords(
  GraphqlChatHistoryFieldsFragmentDoc
);
const graphqlProjectHistorySelection = selectRecords(
  GraphqlProjectHistoryFieldsFragmentDoc
);

type GraphqlHistoryRecord =
  | GraphqlDocumentHistoryFieldsFragment
  | GraphqlChatHistoryFieldsFragment
  | GraphqlProjectHistoryFieldsFragment;
type GraphqlDocumentHistoryEntity = GraphqlDocumentHistoryFieldsFragment;

function transformDocumentSubType(
  subType: GraphqlDocumentHistoryEntity['subType']
): DocumentHistoryItem['subType'] {
  if (!subType) return subType;

  switch (subType.__typename) {
    case 'GraphqlTaskSubType':
      return {
        type: 'task',
        is_completed: subType.isCompleted,
      };
    case 'GraphqlSnippetSubType':
      return { type: 'snippet' };
    case 'GraphqlSkillSubType':
      return { type: 'skill' };
  }
}

/** Maps a normalized GraphQL Soup item to the legacy history shape. */
export function transformGraphqlHistoryItem(
  record: GraphqlHistoryRecord
): HistoryItem | undefined {
  const entity = record;
  switch (entity.__typename) {
    case 'GraphqlSoupDocument': {
      const subType = transformDocumentSubType(entity.subType);
      const safeName = itemToSafeName({
        type: 'document',
        name: entity.documentName,
        fileType: entity.fileType,
        subType,
      });
      return {
        id: entity.id,
        type: 'document',
        name: formatDocumentName(safeName, entity.fileType, {
          fullyQualifiedBlockName: true,
        }),
        rawName: entity.documentName,
        ownerId: entity.ownerId,
        fileType: entity.fileType,
        subType,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        deletedAt: entity.deletedAt,
      };
    }
    case 'GraphqlSoupChat':
      return {
        id: entity.id,
        type: 'chat',
        name: itemToSafeName({ type: 'chat', name: entity.chatName }),
        rawName: entity.chatName,
        ownerId: entity.ownerId,
        isPersistent: entity.isPersistent,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        deletedAt: entity.deletedAt,
      };
    case 'GraphqlSoupProject':
      return {
        id: entity.id,
        type: 'project',
        name: itemToSafeName({ type: 'project', name: entity.projectName }),
        rawName: entity.projectName,
        ownerId: entity.ownerId,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        deletedAt: entity.deletedAt,
      };
    default:
      return undefined;
  }
}

function getSortTimestamp(record: GraphqlHistoryRecord): number {
  const entity = record;
  switch (entity.__typename) {
    case 'GraphqlSoupDocument':
    case 'GraphqlSoupChat':
    case 'GraphqlSoupProject': {
      const timestamp = Date.parse(
        entity.viewedAt ?? entity.updatedAt ?? entity.createdAt
      );
      return Number.isNaN(timestamp) ? 0 : timestamp;
    }
    default:
      return 0;
  }
}

async function readAllCachedRecords<TResult>(
  cacheHost: Pick<CacheHost, 'readRecords'>,
  selection: RecordSelection<TResult>
): Promise<TResult[]> {
  const records: TResult[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const page = await readRecords(cacheHost, selection, {
      cursor,
      limit: MAX_RECORD_SELECTION_PAGE_SIZE,
    });
    records.push(...page.records);
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error('cache record selection returned a repeated cursor');
      }
      seenCursors.add(cursor);
    }
  } while (cursor);

  return records;
}

/**
 * Reads minimal concrete document, chat, and project projections and maps them
 * to the history shape.
 */
export async function readCachedGraphqlHistoryItems(
  cacheHost: Pick<CacheHost, 'readRecords'>
): Promise<HistoryItem[]> {
  const [documents, chats, projects] = await Promise.all([
    readAllCachedRecords(cacheHost, graphqlDocumentHistorySelection),
    readAllCachedRecords(cacheHost, graphqlChatHistorySelection),
    readAllCachedRecords(cacheHost, graphqlProjectHistorySelection),
  ]);
  const records: GraphqlHistoryRecord[] = [...documents, ...chats, ...projects];

  return records
    .flatMap((record) => {
      const item = transformGraphqlHistoryItem(record);
      return item && !item.deletedAt
        ? [{ item, sortTimestamp: getSortTimestamp(record) }]
        : [];
    })
    .sort(
      (a, b) =>
        b.sortTimestamp - a.sortTimestamp || a.item.id.localeCompare(b.item.id)
    )
    .map(({ item }) => item);
}
