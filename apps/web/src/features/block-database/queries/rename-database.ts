import { queryClient } from '@queries/client';
import { invalidateDatabase } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import {
  RenameDatabaseDocument,
  type RenameDatabaseMutation,
  type RenameDatabaseMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import type { CombinedError } from '@urql/core';
import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type { DatabaseEntityFailure } from '../core/write-failure';

/** The slice of the GraphQL client a database rename sends through. */
export type RenameDatabaseClient = {
  mutation(
    document: typeof RenameDatabaseDocument,
    variables: RenameDatabaseMutationVariables
  ): {
    toPromise(): Promise<{
      data?: RenameDatabaseMutation;
      error?: CombinedError;
    }>;
  };
};

export function renameDatabase(
  client: RenameDatabaseClient,
  databaseId: string,
  name: string
): ResultAsync<void, DatabaseEntityFailure> {
  const displayName = name.trim();
  if (!displayName) return errAsync({ kind: 'empty-name' });
  const renamed = async (): Promise<Result<void, DatabaseEntityFailure>> => {
    const response = await client
      .mutation(RenameDatabaseDocument, { id: databaseId, displayName })
      .toPromise();
    const result = response.data?.renameEntities.results[0];
    if (response.error || !result) return err({ kind: 'unreachable' });
    return match(result)
      .returnType<Promise<Result<void, DatabaseEntityFailure>>>()
      .with({ __typename: 'GraphqlMutationError' }, async (refusal) =>
        err({
          kind: 'refused',
          errorCode: refusal.errorCode,
          message: refusal.message,
        })
      )
      .with({ __typename: 'GraphqlMutationSuccess' }, async () => {
        queryClient.setQueryData(
          databasesKeys.detail(databaseId).queryKey,
          (previous: DatabaseDetail | undefined) =>
            previous && {
              ...previous,
              database: { ...previous.database, name: displayName },
            }
        );
        void queryClient.invalidateQueries({
          queryKey: databasesKeys.list.queryKey,
        });
        // Qualified SQL names include the database name; open reads rerun
        // against the reloaded catalog.
        await invalidateDatabase(databaseId);
        return ok(undefined);
      })
      .exhaustive();
  };
  return new ResultAsync(renamed());
}
