import { queryClient } from '@queries/client';
import {
  invalidateDatabase,
  invalidateDatabaseRows,
} from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseDetail } from '@service-storage/databases';
import type { RenameEntitiesMutationVariables } from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';

type RenameDatabaseResult = {
  renameEntities: {
    results: (
      | { __typename: 'GraphqlMutationSuccess' }
      | { __typename: 'GraphqlMutationError'; message: string }
    )[];
  };
};

// Databases are not Soup entities. Request the mutation result without the
// generic rename fragment's Soup effects, whose hydration would fail.
const RENAME_DATABASE = `mutation RenameDatabase($inputs: [RenameEntityInput!]!) {
  renameEntities(inputs: $inputs) {
    results {
      __typename
      ... on GraphqlMutationError { message }
    }
  }
}`;

export async function renameDatabase(
  client: Pick<Client, 'mutation'>,
  databaseId: string,
  name: string
) {
  const displayName = name.trim();
  if (!displayName) throw new Error('Give your database a name.');
  const response = await client
    .mutation<RenameDatabaseResult, RenameEntitiesMutationVariables>(
      RENAME_DATABASE,
      {
        inputs: [{ entity: { type: 'DATABASE', id: databaseId }, displayName }],
      }
    )
    .toPromise();
  if (response.error) throw response.error;
  const result = response.data?.renameEntities.results[0];
  if (!result) throw new Error('The database could not be renamed. Try again.');
  if (result.__typename === 'GraphqlMutationError') {
    throw new Error(result.message);
  }
  const tableIds =
    queryClient
      .getQueryData<DatabaseDetail>(databasesKeys.detail(databaseId).queryKey)
      ?.tables.map(({ table }) => table.id) ?? [];
  queryClient.setQueryData(
    databasesKeys.detail(databaseId).queryKey,
    (previous: DatabaseDetail | undefined) =>
      previous
        ? { ...previous, database: { ...previous.database, name: displayName } }
        : previous
  );
  void queryClient.invalidateQueries({ queryKey: databasesKeys.list.queryKey });
  // Qualified SQL names include the database name. Reload the catalog before
  // refreshing rows so the next read uses the renamed table identifiers.
  await invalidateDatabase(databaseId);
  await Promise.all(
    tableIds.map((tableId) => invalidateDatabaseRows(databaseId, tableId))
  );
}
