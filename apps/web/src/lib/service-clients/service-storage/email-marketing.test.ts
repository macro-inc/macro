import { describe, expect, it, vi } from 'vitest';
import { readMarketingTable } from './email-marketing';

const query = vi.hoisted(() => vi.fn());
vi.mock('./graphql-soup', () => ({ getGraphqlSoupClient: () => ({ query }) }));
describe('Email Marketing table reads', () => {
  it('reads the generated stringValue alias and follows all pages using the server cursor', async () => {
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
                    properties: [
                      {
                        propertyDefinitionId: 'data-property',
                        value: {
                          __typename: 'GraphqlStringPropertyValue',
                          stringValue: '{"id":"second"}',
                        },
                      },
                    ],
                  },
                ],
                nextCursor: null,
              },
            },
          },
        }),
      });
    expect(await readMarketingTable('table', 'data-property')).toEqual([
      { rowId: 'row-1', payload: { id: 'first' } },
      { rowId: 'row-2', payload: { id: 'second' } },
    ]);
    expect(
      query.mock.calls[0][1].input.initial.filters.databaseRowFilter
    ).toEqual({ literal: { tableId: 'table' } });
    expect(query.mock.calls[1][1].input.continuation.cursor).toBe('next-page');
  });
});
