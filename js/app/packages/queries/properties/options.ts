import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { AddPropertyOptionRequest } from '../../service-clients/service-properties/generated/schemas/addPropertyOptionRequest';
import type { PropertyOption } from '../../service-clients/service-properties/generated/schemas/propertyOption';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { propertiesKeys } from './keys';

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
    };
  });
}

export type PropertyOptionsQuery = ReturnType<typeof usePropertyOptionsQuery>;

export function invalidatePropertyOptions(propertyDefinitionId: string) {
  queryClient.invalidateQueries({
    queryKey: propertiesKeys.options({ propertyDefinitionId }).queryKey,
  });
}

export type AddPropertyOptionAsyncMutation = ReturnType<
  typeof useAddPropertyOptionMutation
>['mutateAsync'];

export type AddPropertyOptionParams = {
  propertyDefinitionId: string;
  body: AddPropertyOptionRequest;
};

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
