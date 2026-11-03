import { createUrqlMutation } from '@app/lib/urql-solid/create-urql-mutation';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  CreateSavedViewDocument,
  type CreateSavedViewMutation,
  type CreateSavedViewMutationVariables,
  DeleteSavedViewDocument,
  type DeleteSavedViewMutation,
  type DeleteSavedViewMutationVariables,
  UpdateSavedViewDocument,
  type UpdateSavedViewMutation,
  type UpdateSavedViewMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { CombinedError } from '@urql/core';
import type { CreateSavedView, UpdateSavedView } from '../core/saved-view';

type Options = { refresh: () => Promise<unknown> };
const unconfirmed = () =>
  new CombinedError({
    networkError: new Error(
      'The server did not confirm the saved view change.'
    ),
  });
export const savedViewErrorMessage = (error: CombinedError | null) =>
  error?.graphQLErrors[0]?.message ?? error?.message;

export function useCreateSavedView(options: Options) {
  return createUrqlMutation<
    CreateSavedViewMutation,
    CreateSavedViewMutationVariables,
    CreateSavedView
  >(() => ({
    client: getGraphqlSoupClient(),
    mutation: CreateSavedViewDocument,
    execute: ({ client, input, context }) =>
      Telemetry.span('saved_view.create', async (span) => {
        span.setAttr('saved_view.id', input.id);
        const result = await client
          .mutation(CreateSavedViewDocument, { input }, context)
          .toPromise();
        if (!result.error && !result.data?.createSavedView)
          result.error = unconfirmed();
        if (result.error) span.error('Saved view create failed');
        else if (client === getGraphqlSoupClient())
          fireAndForget(options.refresh(), 'saved-views');
        return result;
      }),
  }));
}

export function useUpdateSavedView(options: Options) {
  return createUrqlMutation<
    UpdateSavedViewMutation,
    UpdateSavedViewMutationVariables,
    UpdateSavedView
  >(() => ({
    client: getGraphqlSoupClient(),
    mutation: UpdateSavedViewDocument,
    execute: ({ client, input, context }) =>
      Telemetry.span('saved_view.update', async (span) => {
        span.setAttr('saved_view.id', input.id);
        const result = await client
          .mutation(
            UpdateSavedViewDocument,
            {
              input: {
                id: input.id,
                name: input.name,
                config: input.config,
                expectedRevision: input.expectedRevision,
                sharing:
                  input.sharedTeamId === undefined
                    ? undefined
                    : { teamId: input.sharedTeamId },
              },
            },
            context
          )
          .toPromise();
        if (!result.error && !result.data?.updateSavedView)
          result.error = unconfirmed();
        if (result.error) span.error('Saved view update failed');
        else if (client === getGraphqlSoupClient())
          fireAndForget(options.refresh(), 'saved-views');
        return result;
      }),
  }));
}

export function useDeleteSavedView(options: Options) {
  return createUrqlMutation<
    DeleteSavedViewMutation,
    DeleteSavedViewMutationVariables,
    DeleteSavedViewMutationVariables['input']
  >(() => ({
    client: getGraphqlSoupClient(),
    mutation: DeleteSavedViewDocument,
    execute: ({ client, input, context }) =>
      Telemetry.span('saved_view.delete', async (span) => {
        span.setAttr('saved_view.id', input.id);
        const result = await client
          .mutation(DeleteSavedViewDocument, { input }, context)
          .toPromise();
        if (!result.error && !result.data) result.error = unconfirmed();
        if (result.error) span.error('Saved view delete failed');
        else if (client === getGraphqlSoupClient())
          fireAndForget(options.refresh(), 'saved-views');
        return result;
      }),
  }));
}
