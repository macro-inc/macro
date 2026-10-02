import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import {
  TrashDatabaseDocument,
  type TrashDatabaseMutation,
  type TrashDatabaseMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import type { CombinedError } from '@urql/core';
import { err, ok, type Result, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type { DatabaseEntityFailure } from '../core/write-failure';

/** The slice of the GraphQL client a database trash sends through. */
export type TrashDatabaseClient = {
  mutation(
    document: typeof TrashDatabaseDocument,
    variables: TrashDatabaseMutationVariables
  ): {
    toPromise(): Promise<{
      data?: TrashDatabaseMutation;
      error?: CombinedError;
    }>;
  };
};

export function trashDatabase(
  client: TrashDatabaseClient,
  databaseId: string
): ResultAsync<void, DatabaseEntityFailure> {
  const trashed = async (): Promise<Result<void, DatabaseEntityFailure>> => {
    const response = await client
      .mutation(TrashDatabaseDocument, { id: databaseId })
      .toPromise();
    const result = response.data?.trashEntities.results[0];
    if (response.error || !result) return err({ kind: 'unreachable' });
    return match(result)
      .returnType<Result<void, DatabaseEntityFailure>>()
      .with({ __typename: 'GraphqlMutationError' }, (refusal) =>
        err({
          kind: 'refused',
          errorCode: refusal.errorCode,
          message: refusal.message,
        })
      )
      .with({ __typename: 'GraphqlMutationSuccess' }, () => {
        queryClient.setQueryData(
          databasesKeys.list.queryKey,
          (previous: ListedDatabase[] | undefined) =>
            previous?.filter(({ database }) => database.id !== databaseId)
        );
        void queryClient.invalidateQueries({
          queryKey: databasesKeys.list.queryKey,
        });
        void queryClient.invalidateQueries({
          queryKey: databasesKeys.detail(databaseId).queryKey,
          refetchType: 'none',
        });
        return ok(undefined);
      })
      .exhaustive();
  };
  return new ResultAsync(trashed());
}
