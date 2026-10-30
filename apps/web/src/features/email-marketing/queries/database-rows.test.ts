import { describe, expect, it, vi } from 'vitest';
import { readMarketingTable } from './database-rows';

const query = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query }),
}));
describe('Email Marketing table reads', () => {
  it('reads name and data cells, keeps empty rows, and follows every page by the server cursor', async () => {
    query
      .mockReturnValueOnce({
        toPromise: async () => ({
          data: {
            user: {
              soup: {
                items: [
                  {
                    __typename: 'GraphqlSoupDatabaseRow',
                    id: 'row-1',
                    properties: [
                      {
                        propertyDefinitionId: 'name-property',
                        value: {
                          __typename: 'GraphqlStringPropertyValue',
                          stringValue: 'First',
                        },
                      },
                      {
                        propertyDefinitionId: 'data-property',
                        value: {
                          __typename: 'GraphqlStringPropertyValue',
                          stringValue: '{"id":"first"}',
                        },
                      },
                    ],
                  },
                ],
                nextCursor: 'next-page',
              },
            },
          },
        }),
      })
      .mockReturnValueOnce({
        toPromise: async () => ({
          data: {
            user: {
              soup: {
                items: [
                  {
                    __typename: 'GraphqlSoupDatabaseRow',
                    id: 'row-2',
                    // A row added in the database view has no cells yet.
                    properties: [],
                  },
                ],
                nextCursor: null,
              },
            },
          },
        }),
      });
    expect(
      await readMarketingTable('table', {
        name: 'name-property',
        data: 'data-property',
      })
    ).toEqual([
      { rowId: 'row-1', name: 'First', data: '{"id":"first"}' },
      { rowId: 'row-2', name: undefined, data: undefined },
    ]);
    expect(
      query.mock.calls[0][1].input.initial.filters.databaseRowFilter
    ).toEqual({ literal: { tableId: 'table' } });
    expect(query.mock.calls[1][1].input.continuation.cursor).toBe('next-page');
  });
});
