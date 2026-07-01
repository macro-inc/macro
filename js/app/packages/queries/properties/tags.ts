import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { EnsureTagSetRequest } from '../../service-clients/service-properties/generated/schemas/ensureTagSetRequest';
import type { PropertyOption } from '../../service-clients/service-properties/generated/schemas/propertyOption';
import type { TagSetResponse } from '../../service-clients/service-properties/generated/schemas/tagSetResponse';
import type { UpdatePropertyOptionRequest } from '../../service-clients/service-properties/generated/schemas/updatePropertyOptionRequest';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { propertiesKeys } from './keys';

/** The caller's tag sets: their personal set, plus their team's set when on a team. */
export function useTagsQuery() {
  return useQuery(() => ({
    queryKey: propertiesKeys.tags.queryKey,
    queryFn: async () =>
      await throwOnErr(async () => await propertiesServiceClient.listTags()),
    staleTime: 1000 * 60 * 5,
  }));
}

export function invalidateTags() {
  queryClient.invalidateQueries({ queryKey: propertiesKeys.tags.queryKey });
}

function invalidatePropertyOptions(propertyDefinitionId: string) {
  queryClient.invalidateQueries({
    queryKey: propertiesKeys.options({ propertyDefinitionId }).queryKey,
  });
}

type EnsureTagSetParams = { scope: EnsureTagSetRequest['scope'] };

/** Provision (get-or-create) the caller's tag definition for a scope. */
export function useEnsureTagSetMutation(
  callbacks?: MutationCallbacks<TagSetResponse, Error, EnsureTagSetParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: EnsureTagSetParams) =>
      await throwOnErr(
        async () =>
          await propertiesServiceClient.ensureTagSet({
            body: { scope: vars.scope },
          })
      ),
    ...withCallbacks<TagSetResponse, Error, EnsureTagSetParams>(
      {
        onError(error) {
          console.error('Failed to provision tag set', error);
          toast.failure('Failed to set up tags');
        },
        onSuccess: () => invalidateTags(),
      },
      callbacks
    ),
  }));
}

type UpdatePropertyOptionParams = {
  propertyDefinitionId: string;
  optionId: string;
  body: UpdatePropertyOptionRequest;
};

/** Rename / recolor a label in place. The option id is preserved so the change propagates. */
export function useUpdatePropertyOptionMutation(
  callbacks?: MutationCallbacks<
    PropertyOption,
    Error,
    UpdatePropertyOptionParams
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: UpdatePropertyOptionParams) =>
      await throwOnErr(
        async () =>
          await propertiesServiceClient.updatePropertyOption({
            definition_id: vars.propertyDefinitionId,
            option_id: vars.optionId,
            body: vars.body,
          })
      ),
    ...withCallbacks<PropertyOption, Error, UpdatePropertyOptionParams>(
      {
        onError(error) {
          console.error('Failed to update label', error);
          toast.failure('Failed to update label');
        },
        onSuccess: (_data, variables) => {
          invalidatePropertyOptions(variables.propertyDefinitionId);
          invalidateTags();
        },
      },
      callbacks
    ),
  }));
}

type DeletePropertyOptionParams = {
  propertyDefinitionId: string;
  optionId: string;
};

/** Delete a label. */
export function useDeletePropertyOptionMutation(
  callbacks?: MutationCallbacks<
    { success: boolean },
    Error,
    DeletePropertyOptionParams
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: DeletePropertyOptionParams) =>
      await throwOnErr(
        async () =>
          await propertiesServiceClient.deletePropertyOption({
            definition_id: vars.propertyDefinitionId,
            option_id: vars.optionId,
          })
      ),
    ...withCallbacks<{ success: boolean }, Error, DeletePropertyOptionParams>(
      {
        onError(error) {
          console.error('Failed to delete label', error);
          toast.failure('Failed to delete label');
        },
        onSuccess: (_data, variables) => {
          invalidatePropertyOptions(variables.propertyDefinitionId);
          invalidateTags();
        },
      },
      callbacks
    ),
  }));
}
