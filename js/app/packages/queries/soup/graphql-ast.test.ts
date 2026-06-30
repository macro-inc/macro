import {
  compileToAst,
  queryStateFrom,
} from '@app/component/next-soup/filters/filter-store';
import { describe, expect, it } from 'vitest';
import { makeGraphqlSoupInput } from './graphql-ast';

const UPDATED_AT = '2026-01-01T00:00:00.000Z';

function makeInput(query: Parameters<typeof queryStateFrom>[0]) {
  return makeGraphqlSoupInput({
    params: { limit: 100, sort_method: 'updated_at' },
    body: compileToAst(queryStateFrom(query)),
  });
}

describe('makeGraphqlSoupInput', () => {
  it('maps compiled soup AST and request params into GraphQL Soup input', () => {
    const input = makeInput({
      include: {
        documentDone: false,
        documentUpdatedAt: { gte: UPDATED_AT },
        emailShared: 'exclude',
      },
      emailView: 'inbox',
    });

    expect(input).toMatchObject({
      limit: 100,
      expand: true,
      sortMethod: 'UPDATED_AT',
      emailView: 'INBOX',
      filters: {
        documentFilter: {
          and: {
            left: { literal: { notificationDone: false } },
            right: { literal: { updatedAt: { gte: UPDATED_AT } } },
          },
        },
        emailFilter: {
          tree: { literal: { shared: 'EXCLUDE' } },
        },
      },
    });
  });

  it('maps property filter values', () => {
    const input = makeInput({
      include: {
        properties: [
          {
            propertyId: '00000000-0000-0000-0000-000000000001',
            type: 'select',
            value: '00000000-0000-0000-0000-000000000002',
          },
        ],
      },
    });

    expect(input.filters?.propertiesFilter).toEqual({
      literal: {
        propertyDefinitionId: '00000000-0000-0000-0000-000000000001',
        value: { selectOption: '00000000-0000-0000-0000-000000000002' },
      },
    });
  });

  it('throws for REST-only file association literals so callers can fall back', () => {
    expect(() =>
      makeInput({
        include: { fileAssoc: ['assoc:pdf'] },
      })
    ).toThrow('Unsupported GraphQL Soup AST');
  });
});
