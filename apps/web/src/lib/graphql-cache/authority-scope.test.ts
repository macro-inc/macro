import { describe, expect, it } from 'vitest';
import {
  excludesCrmContent,
  queryNeedsCrmProof,
  requestNeedsCrmProof,
} from './authority-scope';

const nil = '00000000-0000-0000-0000-000000000000';
const filters = {
  emailFilter: { tree: { literal: { threadId: nil } } },
  crmCompanyFilter: { literal: { id: nil } },
};
describe('CRM cache admission classification', () => {
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
});
