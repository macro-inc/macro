import type { CacheHost, SearchDocumentWire } from '@graphql-cache/index';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import type { GraphqlCrmCompanyQuickAccessFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, vi } from 'vitest';
import { materializeCachedGraphqlCrmCompanies } from './graphql';

const company: GraphqlCrmCompanyQuickAccessFieldsFragment = {
  __typename: 'GraphqlSoupCrmCompany',
  name: 'Acme',
  teamId: 'team-1',
  hidden: false,
  domains: ['acme.example'],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  viewedAt: null,
};
function hit(recordKey: string): SearchDocumentWire {
  return {
    profile: 'quick-access-v1',
    recordKey,
    bucket: 'crm_company',
    searchText: 'acme',
    timestampMs: 1,
    sourceHash: 'hash',
  };
}
function host(record: GraphqlCrmCompanyQuickAccessFieldsFragment = company) {
  return {
    readRecordsByKeys: vi
      .fn<CacheHost['readRecordsByKeys']>()
      .mockResolvedValue({
        revision: INITIAL_CACHE_REVISION,
        records: [{ recordKey: 'GraphqlSoupCrmCompany:company-1', record }],
      }),
  };
}

describe('cached CRM company mentions', () => {
  it('materializes only company hits with their display and mention identity', async () => {
    const cache = host();
    const result = await materializeCachedGraphqlCrmCompanies(cache, [
      hit('GraphqlSoupCrmCompany:company-1'),
      hit('GraphqlSoupDocument:document-1'),
    ]);
    expect(cache.readRecordsByKeys).toHaveBeenCalledWith(
      expect.objectContaining({
        fragmentName: 'GraphqlCrmCompanyQuickAccessFields',
        keys: ['GraphqlSoupCrmCompany:company-1'],
      })
    );
    expect(result).toEqual([
      {
        type: 'crm_company',
        id: 'company-1',
        teamId: 'team-1',
        ownerId: 'team-1',
        name: 'Acme',
        hidden: false,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
        viewedAt: null,
        domains: [
          {
            id: 'company-1:acme.example',
            companyId: 'company-1',
            domain: 'acme.example',
            createdAt: company.createdAt,
          },
        ],
      },
    ]);
  });

  it.each([
    { domains: ['acme.example'], expected: 'acme.example' },
    { domains: [], expected: 'Unknown Company' },
  ])(
    'falls back to $expected when the company has no name',
    async ({ domains, expected }) => {
      const result = await materializeCachedGraphqlCrmCompanies(
        host({ ...company, name: null, domains }),
        [hit('GraphqlSoupCrmCompany:company-1')]
      );
      expect(result[0].name).toBe(expected);
    }
  );

  it('skips hidden companies and cache hits whose records are unavailable', async () => {
    const cache = host({ ...company, hidden: true });
    expect(
      await materializeCachedGraphqlCrmCompanies(cache, [
        hit('GraphqlSoupCrmCompany:company-1'),
        hit('GraphqlSoupCrmCompany:incomplete'),
      ])
    ).toEqual([]);
  });

  it('does not read records for other entity types', async () => {
    const cache = host();
    expect(
      await materializeCachedGraphqlCrmCompanies(cache, [
        hit('GraphqlSoupDocument:document-1'),
      ])
    ).toEqual([]);
    expect(cache.readRecordsByKeys).not.toHaveBeenCalled();
  });
});
