import type { CrmCompanyEntity } from '@entity';
import {
  type CacheHost,
  readRecordsByKeys,
  type SearchDocumentWire,
  selectRecords,
} from '@graphql-cache/index';
import { GraphqlCrmCompanyQuickAccessFieldsFragmentDoc } from '@service-storage/graphql/generated/graphql';

/** Materializes CRM company search hits without requiring the bounded REST feed. */
export async function materializeCachedGraphqlCrmCompanies(
  cacheHost: Pick<CacheHost, 'readRecordsByKeys'>,
  documents: SearchDocumentWire[]
): Promise<CrmCompanyEntity[]> {
  const keys = documents
    .filter((document) =>
      document.recordKey.startsWith('GraphqlSoupCrmCompany:')
    )
    .map((document) => document.recordKey);
  if (keys.length === 0) return [];

  const result = await readRecordsByKeys(
    cacheHost,
    selectRecords(GraphqlCrmCompanyQuickAccessFieldsFragmentDoc),
    keys
  );
  return result.records.flatMap(({ recordKey, record }): CrmCompanyEntity[] => {
    if (record.__typename !== 'GraphqlSoupCrmCompany' || record.hidden)
      return [];
    const id = recordKey.slice(recordKey.indexOf(':') + 1);
    return [
      {
        type: 'crm_company',
        id,
        teamId: record.teamId,
        ownerId: record.teamId,
        name: record.name || record.domains[0] || 'Unknown Company',
        hidden: record.hidden,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        viewedAt: record.viewedAt,
        domains: record.domains.map((domain) => ({
          id: `${id}:${domain}`,
          companyId: id,
          domain,
          createdAt: record.createdAt,
        })),
      },
    ];
  });
}
