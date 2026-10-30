import type { InitiativeEntity } from '@entity';
import {
  type CacheHost,
  readRecordsByKeys,
  type SearchDocumentWire,
  selectRecords,
} from '@graphql-cache/index';
import { InitiativeQuickAccessFieldsFragmentDoc } from '@service-storage/graphql/generated/graphql';

/** Materializes cached project search hits, including projects beyond the
 * bounded REST feed. */
export async function materializeCachedGraphqlInitiatives(
  cacheHost: Pick<CacheHost, 'readRecordsByKeys'>,
  documents: SearchDocumentWire[]
): Promise<InitiativeEntity[]> {
  const keys = documents
    .filter((document) =>
      document.recordKey.startsWith('GraphqlSoupInitiative:')
    )
    .map((document) => document.recordKey);
  if (keys.length === 0) return [];

  const result = await readRecordsByKeys(
    cacheHost,
    selectRecords(InitiativeQuickAccessFieldsFragmentDoc),
    keys
  );
  return result.records.flatMap(({ recordKey, record }): InitiativeEntity[] =>
    record.__typename === 'GraphqlSoupInitiative'
      ? [
          {
            type: 'initiative',
            id: recordKey.slice(recordKey.indexOf(':') + 1),
            name: record.displayName ?? 'Untitled project',
            ownerId: record.metadata.ownerId ?? '',
            createdAt: record.metadata.createdAt,
            updatedAt: record.metadata.updatedAt,
          },
        ]
      : []
  );
}
