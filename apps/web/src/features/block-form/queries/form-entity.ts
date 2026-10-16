/** Renaming and trashing a form: the unified entity mutation router, as for databases. */
import { queryClient } from '@queries/client';
import { invalidatePreview, setPreviewName } from '@queries/preview';
import { databasesKeys, formsKeys } from '@queries/storage/keys';
import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import type { ListedForm } from '@service-storage/generated/schemas/listedForm';
import {
  RenameFormDocument,
  type RenameFormMutation,
  type RenameFormMutationVariables,
  TrashFormDocument,
  type TrashFormMutation,
  type TrashFormMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import type { CombinedError } from '@urql/core';
import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow';
import type { FormWriteFailure } from '../context/form-context';

/** The slice of the GraphQL client form mutations send through. */
export type FormEntityClient = {
  mutation(
    document: typeof RenameFormDocument,
    variables: RenameFormMutationVariables
  ): {
    toPromise(): Promise<{ data?: RenameFormMutation; error?: CombinedError }>;
  };
  mutation(
    document: typeof TrashFormDocument,
    variables: TrashFormMutationVariables
  ): {
    toPromise(): Promise<{ data?: TrashFormMutation; error?: CombinedError }>;
  };
};

type MutationResult =
  | { __typename: 'GraphqlMutationError'; errorCode: string; message: string }
  | { __typename: 'GraphqlMutationSuccess' };

function outcomeOf(
  error: CombinedError | undefined,
  result: MutationResult | undefined
): Result<void, FormWriteFailure> {
  if (error || !result)
    return err({
      message: 'The change could not be sent. Check your connection.',
    });
  if (result.__typename === 'GraphqlMutationError')
    return err({ message: result.message });
  return ok(undefined);
}

function cachedDatabaseIdOf(formId: string): string | undefined {
  return (
    queryClient.getQueryData<FormDetail>(formsKeys.detail(formId).queryKey)
      ?.form.databaseId ??
    queryClient
      .getQueryData<ListedForm[]>(formsKeys.list.queryKey)
      ?.find((listed) => listed.form.id === formId)?.form.databaseId
  );
}

export function renameForm(
  client: FormEntityClient,
  formId: string,
  name: string
): ResultAsync<void, FormWriteFailure> {
  const displayName = name.trim();
  if (!displayName) return errAsync({ message: 'A form needs a name.' });
  const renamed = async () => {
    const response = await client
      .mutation(RenameFormDocument, { id: formId, displayName })
      .toPromise();
    const outcome = outcomeOf(
      response.error,
      response.data?.renameEntities.results[0]
    );
    if (outcome.isOk()) {
      setPreviewName({ itemId: formId, itemType: 'form', name: displayName });
      queryClient.setQueryData(
        formsKeys.detail(formId).queryKey,
        (previous: FormDetail | undefined) =>
          previous && {
            ...previous,
            form: { ...previous.form, name: displayName },
          }
      );
      const databaseId = cachedDatabaseIdOf(formId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: formsKeys.list.queryKey }),
        queryClient.invalidateQueries({
          queryKey: databaseId
            ? databasesKeys.detail(databaseId).queryKey
            : databasesKeys.detail._def,
        }),
        queryClient.invalidateQueries({
          queryKey: databasesKeys.list.queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: databaseId
            ? formsKeys.forDatabase(databaseId).queryKey
            : formsKeys.forDatabase._def,
        }),
        // A standalone form renames its database; the server says whether.
        databaseId ? invalidatePreview(databaseId) : undefined,
      ]);
    }
    return outcome;
  };
  return new ResultAsync(renamed());
}

/** Trash the form; its database and every response row stay. */
export function trashForm(
  client: FormEntityClient,
  formId: string
): ResultAsync<void, FormWriteFailure> {
  const trashed = async () => {
    const response = await client
      .mutation(TrashFormDocument, { id: formId })
      .toPromise();
    const outcome = outcomeOf(
      response.error,
      response.data?.trashEntities.results[0]
    );
    if (outcome.isOk()) {
      void queryClient.invalidateQueries({ queryKey: formsKeys.list.queryKey });
      void queryClient.invalidateQueries({
        queryKey: formsKeys.forDatabase._def,
      });
    }
    return outcome;
  };
  return new ResultAsync(trashed());
}
