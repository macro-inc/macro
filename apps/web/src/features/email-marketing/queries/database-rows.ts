import { buildGraphqlEntitySoupInput } from '@queries/soup/graphql/entity-input';
import {
  DatabaseRowsDocument,
  type DatabaseRowsQuery,
  type DatabaseRowsQueryVariables,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { OperationResult } from '@urql/core';
import { MarketingError } from '../core/errors';

/** One row's text cells, unparsed. Missing cells are `undefined`. */
export type MarketingRow = { rowId: string; name?: string; data?: string };

type Properties = { name: string; data: string };

/** Fully paginated table reads using the same authorized source as Macro Databases. */
export async function readMarketingTable(
  tableId: string,
  properties: Properties
) {
  const base = buildGraphqlEntitySoupInput(
    'DATABASE_ROW',
    '00000000-0000-0000-0000-000000000000'
  )?.initial;
  if (!base) throw new MarketingError('storageUnavailable');
  let input: SoupInput = {
    initial: {
      ...base,
      limit: 500,
      sortMethod: 'CREATED_AT',
      filters: { ...base.filters, databaseRowFilter: { literal: { tableId } } },
    },
  };
  const rows: MarketingRow[] = [];
  for (;;) {
    const result: OperationResult<
      DatabaseRowsQuery,
      DatabaseRowsQueryVariables
    > = await getGraphqlSoupClient()
      .query(DatabaseRowsDocument, { input }, { requestPolicy: 'network-only' })
      .toPromise();
    if (result.error) throw result.error;
    if (!result.data) throw new MarketingError('storageUnavailable');
    const page = result.data.user.soup;
    for (const item of page.items) {
      if (item.__typename !== 'GraphqlSoupDatabaseRow') continue;
      const text = (propertyId: string) => {
        const value = item.properties.find(
          (property) => property.propertyDefinitionId === propertyId
        )?.value;
        return value?.__typename === 'GraphqlStringPropertyValue'
          ? value.stringValue
          : undefined;
      };
      rows.push({
        rowId: String(item.id),
        name: text(properties.name),
        data: text(properties.data),
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
