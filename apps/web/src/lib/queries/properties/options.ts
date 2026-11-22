import { toast } from '@core/component/Toast/Toast';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import type { AddPropertyOptionRequest } from '@service-properties/generated/schemas/addPropertyOptionRequest';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { UpdatePropertyOptionRequest } from '@service-properties/generated/schemas/updatePropertyOptionRequest';
import { PropertyCatalogOptionsDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Accessor } from 'solid-js';
import {
  type CatalogListResult,
  catalogListResult,
  createListedAt,
} from './catalog/list-result';
import { toPropertyOptions } from './catalog/map';
import {
  type CatalogMutationCallbacks,
  createCatalogMutation,
} from './catalog/mutation';
import { registerCatalogReader } from './catalog/readers';
import {
  addPropertyOption,
  deletePropertyOption,
  updatePropertyOption,
} from './catalog/writes';

// Stable empty default so `data` is never undefined while the list loads.
const EMPTY_OPTIONS: PropertyOption[] = [];

/** One definition's options in display order, read live from the cache. */
export function usePropertyOptionsQuery(
  propertyDefinitionId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
): CatalogListResult<PropertyOption> {
  const stamp = createListedAt();
  const variables = () => {
    const id = propertyDefinitionId();
    return enabled() && id ? { propertyDefinitionId: id } : undefined;
  };
  const query = createLiveQuery(
    PropertyCatalogOptionsDocument,
    variables,
    () => ({
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: (data) => toPropertyOptions(data.user.propertyOptions),
      onResult: stamp.onResult,
    })
  );
  registerCatalogReader({
    kind: 'options',
    propertyDefinitionId: () => variables()?.propertyDefinitionId,
    refresh: () => query.refetch({ requestPolicy: 'network-only' }),
  });
  return catalogListResult(query, stamp.listedAt, EMPTY_OPTIONS);
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

type DeletePropertyOptionParams = {
  propertyDefinitionId: string;
  optionId: string;
};

const updateFailed = () => toast.failure('Failed to update option');
const deleteFailed = () => toast.failure('Failed to delete option');

export function useUpdatePropertyOptionMutation(
  callbacks?: CatalogMutationCallbacks<void, UpdatePropertyOptionParams>
) {
  return createCatalogMutation(
    (vars: UpdatePropertyOptionParams) =>
      updatePropertyOption(
        vars.propertyDefinitionId,
        vars.optionId,
        vars.body,
        updateFailed
      ),
    {
      onError(error) {
        console.error('Failed to update property option', error);
        updateFailed();
      },
    },
    callbacks
  );
}

export function useDeletePropertyOptionMutation(
  callbacks?: CatalogMutationCallbacks<void, DeletePropertyOptionParams>
) {
  return createCatalogMutation(
    (vars: DeletePropertyOptionParams) =>
      deletePropertyOption(
        vars.propertyDefinitionId,
        vars.optionId,
        deleteFailed
      ),
    {
      onError(error) {
        console.error('Failed to delete property option', error);
        deleteFailed();
      },
    },
    callbacks
  );
}

/** Adds an option; resolves with the server's option once it commits. */
export function useAddPropertyOptionMutation(
  callbacks?: CatalogMutationCallbacks<PropertyOption, AddPropertyOptionParams>
) {
  return createCatalogMutation(
    (vars: AddPropertyOptionParams) =>
      addPropertyOption(vars.propertyDefinitionId, vars.body),
    {
      onError(error) {
        console.error('Failed to add property option', error);
        toast.failure('Failed to add option');
      },
    },
    callbacks
  );
}
