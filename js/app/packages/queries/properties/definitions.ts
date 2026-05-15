import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { CreatePropertyDefinitionRequest } from '../../service-clients/service-properties/generated/schemas/createPropertyDefinitionRequest';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import type { PropertyDefinition } from '../../service-clients/service-properties/generated/schemas/propertyDefinition';
import type { PropertyScope } from '../../service-clients/service-properties/generated/schemas/propertyScope';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { propertiesKeys } from './keys';

export type ListPropertiesQueryParams = {
  scope: PropertyScope;
  includeOptions: boolean;
  forEntityType?: EntityType;
};

export function useListPropertiesQuery(
  params: Accessor<ListPropertiesQueryParams>,
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => {
    const { scope, includeOptions, forEntityType } = params();
    return {
      queryKey: propertiesKeys.definitions({
        scope,
        includeOptions,
        forEntityType,
      }).queryKey,
      queryFn: async () => {
        const data = await throwOnErr(
          async () =>
            await propertiesServiceClient.listProperties({
              scope,
              include_options: includeOptions,
              for_entity_type: forEntityType,
            })
        );
        return data;
      },
      enabled: enabled(),
      staleTime: 1000 * 60 * 5, // 5 minutes
    };
  });
}

export function invalidatePropertyDefinitions() {
  queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey.includes('properties') && queryKey.includes('definitions'),
  });
}

export type CreatePropertyDefinitionParams = {
  body: CreatePropertyDefinitionRequest;
};

export function useCreatePropertyDefinitionMutation(
  callbacks?: MutationCallbacks<
    PropertyDefinition,
    Error,
    CreatePropertyDefinitionParams
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: CreatePropertyDefinitionParams) => {
      const result = await throwOnErr(
        async () =>
          await propertiesServiceClient.createPropertyDefinition({
            body: vars.body,
          })
      );
      return result;
    },
    ...withCallbacks<PropertyDefinition, Error, CreatePropertyDefinitionParams>(
      {
        onError(error) {
          console.error('Failed to create property definition', error);
          toast.failure('Failed to create property');
        },
        onSuccess: () => {
          invalidatePropertyDefinitions();
        },
      },
      callbacks
    ),
  }));
}
