import type { UrqlQueryResult } from '@app/lib/urql-solid/types';
import { toast } from '@core/component/Toast/Toast';
import { useIsAuthenticated } from '@core/context/user';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import type { CreatePropertyDefinitionRequest } from '@service-properties/generated/schemas/createPropertyDefinitionRequest';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
import type { PropertyScope } from '@service-properties/generated/schemas/propertyScope';
import {
  type GraphqlPropertyEntityType,
  PropertyCatalogDefinitionsDocument,
  type PropertyCatalogDefinitionsQuery,
  PropertyCatalogDefinitionsWithOptionsDocument,
  type PropertyCatalogDefinitionsWithOptionsQuery,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createMemo, untrack } from 'solid-js';
import {
  toDefinitionWithOptions,
  toGraphqlDefinitionScope,
  toPropertyDefinition,
} from './catalog/map';
import {
  type CatalogMutationCallbacks,
  createCatalogMutation,
} from './catalog/mutation';
import {
  refreshCatalogReaders,
  registerCatalogReader,
} from './catalog/readers';
import {
  createPropertyDefinition,
  deletePropertyDefinition,
  isCatalogErrorCode,
} from './catalog/writes';

type ListPropertiesQueryParams = {
  scope: PropertyScope;
  includeOptions: boolean;
  forEntityType?: EntityType;
};

function definitionsWithOptions(
  data: PropertyCatalogDefinitionsWithOptionsQuery
): PropertyDefinitionResponse[] {
  return data.user.propertyDefinitions.flatMap(
    (definition) => toDefinitionWithOptions(definition) ?? []
  );
}

function definitionsOnly(
  data: PropertyCatalogDefinitionsQuery
): PropertyDefinitionResponse[] {
  return data.user.propertyDefinitions.flatMap(
    (definition) => toPropertyDefinition(definition) ?? []
  );
}

/** A definitions list; a successful read always carries its list. */
export type PropertyDefinitionsQuery = Omit<
  UrqlQueryResult<PropertyDefinitionResponse[]>,
  'isSuccess'
> &
  (
    | { readonly isSuccess: true; readonly data: PropertyDefinitionResponse[] }
    | { readonly isSuccess: false }
  );

const READ_OPTIONS = {
  requestPolicy: 'cache-and-network',
  keepPreviousData: false,
} as const;

/**
 * The viewer's property definitions in the server's order, read live from
 * the normalized cache. With `includeOptions` (fixed per call site), each
 * carries its options.
 */
export function useListPropertiesQuery(
  params: Accessor<ListPropertiesQueryParams>,
  enabled: Accessor<boolean> = () => true
): PropertyDefinitionsQuery {
  const authenticated = useIsAuthenticated();
  const variables = createMemo(
    () => {
      if (authenticated() !== true || !enabled()) return undefined;
      const { scope, forEntityType } = params();
      return {
        scope: toGraphqlDefinitionScope(scope),
        forEntityType: (forEntityType ??
          null) as GraphqlPropertyEntityType | null,
      };
    },
    undefined,
    {
      equals: (a, b) =>
        a?.scope === b?.scope && a?.forEntityType === b?.forEntityType,
    }
  );
  const withOptions = untrack(() => params().includeOptions);
  const query = withOptions
    ? createLiveQuery(
        PropertyCatalogDefinitionsWithOptionsDocument,
        variables,
        () => ({
          ...READ_OPTIONS,
          client: getGraphqlSoupClient(),
          select: definitionsWithOptions,
        })
      )
    : createLiveQuery(PropertyCatalogDefinitionsDocument, variables, () => ({
        ...READ_OPTIONS,
        client: getGraphqlSoupClient(),
        select: definitionsOnly,
      }));

  registerCatalogReader({
    kind: 'definitions',
    variables,
    withOptions,
    definitionIds: () =>
      (query.data ?? []).map((item) =>
        'definition' in item ? item.definition.id : item.id
      ),
    refresh: () => query.refetch({ requestPolicy: 'network-only' }),
  });
  return query as unknown as PropertyDefinitionsQuery;
}

/** One definition with its options, read from the server. */
export async function fetchPropertyDefinitionWithOptions(
  definitionId: string
): Promise<PropertyDefinitionResponse | undefined> {
  const result = await getGraphqlSoupClient()
    .query(
      PropertyCatalogDefinitionsWithOptionsDocument,
      { scope: 'ALL', forEntityType: null },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Property definitions returned no data');
  return definitionsWithOptions(result.data).find((item) =>
    'definition' in item
      ? item.definition.id === definitionId
      : item.id === definitionId
  );
}

type CreatePropertyDefinitionParams = {
  body: CreatePropertyDefinitionRequest;
};

type DeletePropertyDefinitionParams = {
  definitionId: string;
};

const deleteFailed = () => toast.failure('Failed to delete property');

export function useDeletePropertyDefinitionMutation(
  callbacks?: CatalogMutationCallbacks<void, DeletePropertyDefinitionParams>
) {
  return createCatalogMutation(
    (vars: DeletePropertyDefinitionParams) =>
      deletePropertyDefinition(vars.definitionId, deleteFailed),
    {
      onError(error) {
        console.error('Failed to delete property definition', error);
        deleteFailed();
      },
    },
    callbacks
  );
}

/** Whether a failed create was the server refusing a built-in property's name. */
export function isPropertyNameReserved(error: unknown): boolean {
  // Creating a definition conflicts only on a reserved name.
  return isCatalogErrorCode(error, 'CONFLICT');
}

export function useCreatePropertyDefinitionMutation(
  callbacks?: CatalogMutationCallbacks<
    PropertyDefinition,
    CreatePropertyDefinitionParams
  >
) {
  return createCatalogMutation(
    (vars: CreatePropertyDefinitionParams) =>
      createPropertyDefinition(vars.body),
    {
      onError(error) {
        console.error('Failed to create property definition', error);
        // The caller says why a built-in name was refused.
        if (isPropertyNameReserved(error)) return;
        toast.failure('Failed to create property');
      },
    },
    callbacks
  );
}

/**
 * Reload the definition and option lists on screen, for a server-side change
 * no catalog write described (such as replacing the CRM stages). Without the
 * cache, the client reloads mounted queries after any mutation itself.
 */
export function refreshPropertyDefinitions(): Promise<void> {
  return refreshCatalogReaders(['definitions', 'options']);
}
