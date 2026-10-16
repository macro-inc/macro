import type { CrmCompanyEntity, CrmContactEntity } from '@entity';
import {
  type CacheHost,
  readRecordsByKeys,
  type SearchDocumentWire,
  selectRecords,
} from '@graphql-cache/index';
import {
  GraphqlCrmCompanyQuickAccessFieldsFragmentDoc,
  type GraphqlCrmContactFieldsFragment,
  GraphqlCrmContactFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';

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

export function toCrmContactEntity(
  contact: GraphqlCrmContactFieldsFragment
): CrmContactEntity {
  return {
    type: 'crm_contact',
    id: contact.id,
    teamId: contact.contactTeamId,
    ownerId: contact.contactTeamId,
    companyId: contact.companyId,
    companyName: contact.companyName,
    email: contact.email,
    name: contact.crmContactName?.trim() || contact.email,
    hidden: contact.hidden,
    firstInteraction: contact.firstInteraction,
    lastInteraction: contact.lastInteraction,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    viewedAt: contact.viewedAt,
  };
}

/** Materializes contact search hits beyond the bounded suggestion feed. */
export async function materializeCachedGraphqlCrmContacts(
  cacheHost: Pick<CacheHost, 'readRecordsByKeys'>,
  documents: SearchDocumentWire[]
): Promise<CrmContactEntity[]> {
  const keys = documents
    .filter((document) =>
      document.recordKey.startsWith('GraphqlSoupCrmContact:')
    )
    .map((document) => document.recordKey);
  if (keys.length === 0) return [];
  const result = await readRecordsByKeys(
    cacheHost,
    selectRecords(GraphqlCrmContactFieldsFragmentDoc),
    keys
  );
  return result.records.flatMap(({ record }) =>
    record.__typename === 'GraphqlSoupCrmContact' && !record.hidden
      ? [toCrmContactEntity(record)]
      : []
  );
}
