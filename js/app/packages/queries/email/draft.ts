import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { emailClient } from '@service-email/client';
import type {
  ApiDraftInput,
  CreateDraftResponse,
} from '@service-email/generated/schemas';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { emailKeys } from './keys';
import { invalidateSoupEntity, invalidateAllSoup } from '@queries/soup/cache';

type CreateDraftParams = {
  draft: ApiDraftInput;
  sendTime?: Date | null;
};

/**
 * Mutation to save a new email draft.
 */
export function useSaveDraftMutation(
  callbacks?: MutationCallbacks<CreateDraftResponse, Error, CreateDraftParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: CreateDraftParams) => {
      return await throwOnErr(
        async () =>
          await emailClient.createDraft({
            draft: vars.draft,
            send_time: vars.sendTime?.toISOString() ?? null,
          })
      );
    },
    ...withCallbacks<CreateDraftResponse, Error, CreateDraftParams>(
      {
        onError(error) {
          console.error('Failed to save draft', error);
          toast.failure('Failed to save draft');
        },
        onSuccess() {
          queryClient.invalidateQueries({
            queryKey: emailKeys.previews._def,
          });
          invalidateAllSoup();
        },
      },
      callbacks
    ),
  }));
}

type DeleteDraftParams = {
  draftId: string;
};

/**
 * Mutation to delete an email draft.
 */
export function useDeleteDraftMutation(
  callbacks?: MutationCallbacks<void, Error, DeleteDraftParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: DeleteDraftParams) => {
      await throwOnErr(
        async () => await emailClient.deleteDraft({ id: vars.draftId })
      );
    },
    ...withCallbacks<void, Error, DeleteDraftParams>(
      {
        onError(error) {
          console.error('Failed to delete draft', error);
          toast.failure('Failed to delete draft');
        },
        onSuccess(_data, vars) {
          queryClient.invalidateQueries({
            queryKey: emailKeys.previews._def,
          });
          invalidateSoupEntity(vars.draftId);
        },
      },
      callbacks
    ),
  }));
}
