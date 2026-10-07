import { queryClient } from '@queries/client';
import { invalidatePreview } from '@queries/preview';
import { invalidateDatabase } from '@queries/storage/databases';
import { databasesKeys, formsKeys } from '@queries/storage/keys';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { Form } from '@service-storage/generated/schemas/form';
import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import type { ListedForm } from '@service-storage/generated/schemas/listedForm';
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

/** Every cached form over the database; previews carry no database id. */
function cachedFormIdsOver(databaseId: string): Set<string> {
  const forms = [
    ...(queryClient.getQueryData<Form[]>(
      formsKeys.forDatabase(databaseId).queryKey
    ) ?? []),
    ...(
      queryClient.getQueryData<ListedForm[]>(formsKeys.list.queryKey) ?? []
    ).map((listed) => listed.form),
    ...queryClient
      .getQueriesData<FormDetail>({ queryKey: formsKeys.detail._def })
      .flatMap(([, detail]) => (detail ? [detail.form] : [])),
  ];
  return new Set(
    forms
      .filter((form) => form.databaseId === databaseId)
      .map((form) => form.id)
  );
}

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
        // Standalone forms read their name from this database. Refetch the
        // server's names, previews included: forms attached to existing
        // tables stay independent.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: formsKeys.detail._def }),
          queryClient.invalidateQueries({
            queryKey: formsKeys.forDatabase(databaseId).queryKey,
          }),
          queryClient.invalidateQueries({ queryKey: formsKeys.list.queryKey }),
        ]);
        await Promise.all(
          [...cachedFormIdsOver(databaseId)].map((formId) =>
            invalidatePreview(formId)
          )
        );
        return ok(undefined);
      })
      .exhaustive();
  };
  return new ResultAsync(renamed());
}
