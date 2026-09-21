import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import type { ListedDatabase } from '@service-storage/databases';
import type { TrashEntitiesMutationVariables } from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';

type TrashDatabaseResult = {
  trashEntities: {
    results: (
      | { __typename: 'GraphqlMutationSuccess' }
      | { __typename: 'GraphqlMutationError'; message: string }
    )[];
  };
};

// Like database rename, request the outcome without Soup effects: databases
// have their own catalog and cannot be hydrated as Soup entities.
const TRASH_DATABASE = `mutation TrashDatabase($entities: [EntityRefInput!]!) {
  trashEntities(entities: $entities) {
    results {
      __typename
      ... on GraphqlMutationError { message }
    }
  }
}`;

export async function trashDatabase(
  client: Pick<Client, 'mutation'>,
  databaseId: string
) {
  const response = await client
    .mutation<TrashDatabaseResult, TrashEntitiesMutationVariables>(
      TRASH_DATABASE,
      {
        entities: [{ type: 'DATABASE', id: databaseId }],
      }
    )
    .toPromise();
  if (response.error) throw response.error;
  const result = response.data?.trashEntities.results[0];
  if (!result) throw new Error('The database could not be deleted. Try again.');
  if (result.__typename === 'GraphqlMutationError')
    throw new Error(result.message);
  queryClient.setQueryData(
    databasesKeys.list.queryKey,
    (previous: ListedDatabase[] | undefined) =>
      previous?.filter(({ database }) => database.id !== databaseId)
  );
  void queryClient.invalidateQueries({ queryKey: databasesKeys.list.queryKey });
  void queryClient.invalidateQueries({
    queryKey: databasesKeys.detail(databaseId).queryKey,
    refetchType: 'none',
  });
}
