import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { AddPropertyOptionRequest } from '../../service-clients/service-properties/generated/schemas/addPropertyOptionRequest';
import type { PropertyOption } from '../../service-clients/service-properties/generated/schemas/propertyOption';
import type { UpdatePropertyOptionRequest } from '../../service-clients/service-properties/generated/schemas/updatePropertyOptionRequest';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { propertiesKeys } from './keys';

// Stable empty default so `data` is never undefined: a shared query that errors
// with undefined data under an app-shell Suspense boundary would remount-loop.
const EMPTY_OPTIONS: PropertyOption[] = [];

export function usePropertyOptionsQuery(
  propertyDefinitionId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => {
    const defId = propertyDefinitionId();
    return {
      queryKey: propertiesKeys.options({ propertyDefinitionId: defId })
        .queryKey,
      queryFn: async () => {
        const result = await throwOnErr(
          async () =>
            await propertiesServiceClient.getPropertyOptions({
              definition_id: defId,
            })
        );
        return result;
      },
      enabled: enabled(),
      staleTime: 1000 * 60 * 5, // 5 minutes
      placeholderData: EMPTY_OPTIONS,
    };
  });
}

function invalidatePropertyOptions(propertyDefinitionId: string) {
  queryClient.invalidateQueries({
    queryKey: propertiesKeys.options({ propertyDefinitionId }).queryKey,
  });
}

export type AddPropertyOptionAsyncMutation = ReturnType<
  typeof useAddPropertyOptionMutation
>['mutateAsync'];

type AddPropertyOptionParams = {
  propertyDefinitionId: string;
  body: AddPropertyOptionRequest;
};

type UpdatePropertyOptionParams = {
  propertyDefinitionId: string;
  optionId: string;
  body: UpdatePropertyOptionRequest;
};

export function useUpdatePropertyOptionMutation(
  callbacks?: MutationCallbacks<
    PropertyOption,
    Error,
    UpdatePropertyOptionParams
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: UpdatePropertyOptionParams) => {
      const result = await throwOnErr(
        async () =>
          await propertiesServiceClient.updatePropertyOption({
            definition_id: vars.propertyDefinitionId,
            option_id: vars.optionId,
            body: vars.body,
          })
      );
      return result;
    },
    ...withCallbacks<PropertyOption, Error, UpdatePropertyOptionParams>(
      {
        onError(error) {
          console.error('Failed to update property option', error);
          toast.failure('Failed to update option');
        },
        onSuccess: (_data, variables) => {
          invalidatePropertyOptions(variables.propertyDefinitionId);
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

export function useDeletePropertyOptionMutation(
  callbacks?: MutationCallbacks<unknown, Error, DeletePropertyOptionParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: DeletePropertyOptionParams) => {
      return await throwOnErr(
        async () =>
          await propertiesServiceClient.deletePropertyOption({
            definition_id: vars.propertyDefinitionId,
            option_id: vars.optionId,
          })
      );
    },
    ...withCallbacks<unknown, Error, DeletePropertyOptionParams>(
      {
        onError(error) {
          console.error('Failed to delete property option', error);
          toast.failure('Failed to delete option');
        },
        onSuccess: (_data, variables) => {
          invalidatePropertyOptions(variables.propertyDefinitionId);
        },
      },
      callbacks
    ),
  }));
}

export function useAddPropertyOptionMutation(
  callbacks?: MutationCallbacks<PropertyOption, Error, AddPropertyOptionParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: AddPropertyOptionParams) => {
      const result = await throwOnErr(
        async () =>
          await propertiesServiceClient.addPropertyOption({
            definition_id: vars.propertyDefinitionId,
            body: vars.body,
          })
      );
      return result;
    },
    ...withCallbacks<PropertyOption, Error, AddPropertyOptionParams>(
      {
        onError(error) {
          console.error('Failed to add property option', error);
          toast.failure('Failed to add option');
        },
        onSuccess: (_data, variables) => {
          invalidatePropertyOptions(variables.propertyDefinitionId);
        },
      },
      callbacks
    ),
  }));
}
