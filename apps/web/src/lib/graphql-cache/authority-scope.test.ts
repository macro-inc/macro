import type { GraphqlSoupEntityType } from '@service-storage/graphql/generated/graphql';
import { parse } from 'graphql';
import { describe, expect, it, vi } from 'vitest';

vi.mock('graphql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('graphql')>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

import {
  excludesCrmContent,
  queryNeedsCrmProof,
  rememberOwnedEmail,
  requestNeedsCrmProof,
} from './authority-scope';

const nil = '00000000-0000-0000-0000-000000000000';
const filters = {
  emailFilter: { tree: { literal: { threadId: nil } } },
  crmCompanyFilter: { literal: { id: nil } },
};
describe('CRM cache admission classification', () => {
  it('parses a repeated document once while rechecking mutable arguments and the selected operation', () => {
    const query =
      'query Scoped($input: SoupInput!) { user { soup(input:$input) { items { id } } } } query Independent { user { favorites { id } } }';
    const mutableFilters: Record<string, unknown> = { ...filters };
    const variables = {
      input: {
        initial: {
          filters: mutableFilters,
        },
      },
    };
    vi.mocked(parse).mockClear();
    for (let index = 0; index < 100; index++)
      expect(queryNeedsCrmProof(query, variables, 'Scoped')).toBe(false);
    variables.input.initial.filters.crmAssociation = { companyId: 'company' };
    expect(queryNeedsCrmProof(query, variables, 'Scoped')).toBe(true);
    expect(queryNeedsCrmProof(query, variables, 'Independent')).toBe(false);
    expect(queryNeedsCrmProof(query, variables, 'Missing')).toBe(true);
    expect(parse).toHaveBeenCalledOnce();
  });
  it('admits an owned Soup email lookup only for its current witness', () => {
    const input = {
      entityType: 'EMAIL_THREAD' satisfies GraphqlSoupEntityType,
      id: 'owned-soup-thread',
    };
    const query =
      'query($input: SoupEntityInput!) { user { soupEntity(input:$input) { id } } }';
    let current = true;
    rememberOwnedEmail(input.id, () => current);
    expect(queryNeedsCrmProof(query, { input })).toBe(false);
    expect(
      queryNeedsCrmProof(query, {
        input: { ...input, id: 'crm-shared-thread' },
      })
    ).toBe(true);
    current = false;
    expect(queryNeedsCrmProof(query, { input })).toBe(true);
  });
  it('continues checking siblings of personal resolver fields', () => {
    expect(
      queryNeedsCrmProof(
        '{ user { workFeed { entries { id } } soupEntity(input:{entityType:CRM_CONTACT}) { id } } }'
      )
    ).toBe(true);
    expect(
      queryNeedsCrmProof(
        '{ user { emailFocus { id } favorites { id } databaseViewRows { items { id } } } }'
      )
    ).toBe(false);
  });
  it('allows only minimal mail ownership metadata before an ownership witness', () => {
    const request = {
      keys: ['GraphqlSoupEmailThread:unknown'],
      fragmentName: 'Owner',
      document: 'fragment Owner on GraphqlSoupEmailThread { id ownerId }',
    };
    expect(requestNeedsCrmProof('read-records-by-keys', request)).toBe(false);
    expect(
      requestNeedsCrmProof('read-records-by-keys', {
        ...request,
        document:
          'fragment Owner on GraphqlSoupEmailThread { id ownerId cacheProjection }',
      })
    ).toBe(true);
  });
  it('resolves each aliased entity lookup independently and closes unknown kinds', () => {
    const query =
      'query($a: SoupEntityInput!, $b: SoupEntityInput!) { user { safe: soupEntity(input: $a) { id } private: soupEntity(input: $b) { id } } }';
    expect(
      queryNeedsCrmProof(query, {
        a: { entityType: 'DOCUMENT' },
        b: { entityType: 'CRM_CONTACT' },
      })
    ).toBe(true);
    expect(
      queryNeedsCrmProof(query, {
        a: { entityType: 'DOCUMENT' },
        b: { entityType: 'UNKNOWN' },
      })
    ).toBe(true);
    expect(
      queryNeedsCrmProof(
        'query { user { soupEntity(input: {entityType: DOCUMENT}) { id } } }'
      )
    ).toBe(false);
  });
  it('requires a positive exclusion under the real initial input, not a negated or cursor filter', () => {
    expect(excludesCrmContent(filters)).toBe(true);
    expect(
      excludesCrmContent({
        ...filters,
        crmCompanyFilter: { not: filters.crmCompanyFilter },
      })
    ).toBe(false);
    const query =
      'query($input: SoupInput!) { user { soup(input: $input) { items { id } } } }';
    expect(queryNeedsCrmProof(query, { input: { initial: { filters } } })).toBe(
      false
    );
    expect(
      queryNeedsCrmProof(query, { input: { after: 'cursor', filters } })
    ).toBe(true);
  });
  it('protects raw viewer aggregates and unwraps native scoped hydration', () => {
    expect(
      requestNeedsCrmProof('read-records-by-keys', {
        keys: ['GraphqlUser:viewer'],
      })
    ).toBe(true);
    expect(
      requestNeedsCrmProof('graphql_cache_hydrate_scoped', {
        request: {
          query: '{ user { emailThread(input:{threadId:"a"}) { id } } }',
        },
      })
    ).toBe(true);
    expect(
      requestNeedsCrmProof('read-records-by-keys', {
        keys: ['GraphqlSoupDocument:a'],
      })
    ).toBe(false);
  });
  it('keeps ordinary database row contracts independent while CRM pipeline and association content stays protected', () => {
    const query =
      'query($input: SoupInput!) { user { soup(input:$input) { items { ... on GraphqlSoupDatabaseRow { id } } } } }';
    const rowFilters = {
      ...filters,
      databaseRowFilter: { literal: { tableId: 'table' } },
    };
    expect(
      queryNeedsCrmProof(query, { input: { initial: { filters: rowFilters } } })
    ).toBe(false);
    expect(
      queryNeedsCrmProof(query, {
        input: {
          initial: {
            filters: { ...rowFilters, crmAssociation: { company: 'company' } },
          },
        },
      })
    ).toBe(true);
    expect(
      queryNeedsCrmProof(
        '{ user { soupEntity(input:{entityType:DATABASE_ROW,id:"row"}) { id } } }'
      )
    ).toBe(false);
    expect(
      requestNeedsCrmProof('entity-filter', {
        request: { filters: rowFilters },
      })
    ).toBe(false);
    expect(
      requestNeedsCrmProof('read-records-by-keys', {
        keys: ['GraphqlSoupDatabaseRow:row'],
      })
    ).toBe(false);
    expect(
      requestNeedsCrmProof('read-records-by-keys', {
        keys: ['GraphqlCrmPipelineEntry:entry'],
      })
    ).toBe(true);
  });
});
