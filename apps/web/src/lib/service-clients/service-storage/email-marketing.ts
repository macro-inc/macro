import { buildGraphqlEntitySoupInput } from '@queries/soup/graphql/entity-input';
import type { OperationResult } from '@urql/core';
import {
  DatabaseRowsDocument,
  type DatabaseRowsQuery,
  type DatabaseRowsQueryVariables,
  type SoupInput,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient } from './graphql-soup';

/** Fully paginated table reads using the same authorized source as Macro Databases. */
export async function readMarketingTable(tableId: string, propertyId: string) {
  const base = buildGraphqlEntitySoupInput(
    'DATABASE_ROW',
    '00000000-0000-0000-0000-000000000000'
  )?.initial;
  if (!base) throw new Error('Database row query is unavailable.');
  let input: SoupInput = {
    initial: {
      ...base,
      limit: 500,
      sortMethod: 'CREATED_AT',
      filters: { ...base.filters, databaseRowFilter: { literal: { tableId } } },
    },
  };
  const rows: { rowId: string; payload: unknown }[] = [];
  for (;;) {
    const result: OperationResult<
      DatabaseRowsQuery,
      DatabaseRowsQueryVariables
    > = await getGraphqlSoupClient()
      .query(DatabaseRowsDocument, { input }, { requestPolicy: 'network-only' })
      .toPromise();
    if (result.error) throw result.error;
    if (!result.data)
      throw new Error('Could not read Email Marketing records.');
    const page = result.data.user.soup;
    for (const item of page.items) {
      if (item.__typename !== 'GraphqlSoupDatabaseRow') continue;
      const value = item.properties.find(
        (property) => property.propertyDefinitionId === propertyId
      )?.value;
      if (!value || value.__typename !== 'GraphqlStringPropertyValue')
        throw new Error('An Email Marketing record is missing its data.');
      rows.push({
        rowId: String(item.id),
        payload: JSON.parse(value.stringValue),
      });
    }
    if (!page.nextCursor) return rows;
    input = {
      continuation: {
        cursor: page.nextCursor,
        expand: true,
        sortDirection: 'DESC',
      },
    };
  }
}
