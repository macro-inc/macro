import { ThrownResultError } from '@core/util/result';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionDetailResponse } from '@service-properties/generated/schemas/propertyDefinitionDetailResponse';
import type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { PropertyOptionValue } from '@service-properties/generated/schemas/propertyOptionValue';
import type { PropertyOwner } from '@service-properties/generated/schemas/propertyOwner';
import type { PropertyScope } from '@service-properties/generated/schemas/propertyScope';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import {
  type AnyVariables,
  type CombinedError,
  createRequest,
  type GraphQLRequest,
} from '@urql/core';
import { match } from 'ts-pattern';
import {
  type GraphqlPropertyDefinitionScope,
  type PropertyCatalogDefinitionFieldsFragment,
  PropertyCatalogDefinitionsDocument,
  PropertyCatalogDefinitionsWithOptionsDocument,
  type PropertyCatalogOptionFieldsFragment,
  PropertyCatalogOptionsDocument,
  PropertyCatalogTagSetsDocument,
  type PropertyCatalogTagSetsQuery,
} from './graphql/generated/graphql';
import { getGraphqlSoupNetworkClient } from './graphql-soup';

// The property catalog is read over GraphQL but written over the properties
// REST service, whose TanStack queries own refresh and optimism. These reads
// are fetch-only (no normalized cache) and return the REST shapes, so the
// queries and their callers stay unchanged.

type GraphqlTagSet = PropertyCatalogTagSetsQuery['user']['tagSets'][number];

type DefinitionWithOptions = PropertyCatalogDefinitionFieldsFragment & {
  options: PropertyCatalogOptionFieldsFragment[];
};

function toGraphqlScope(scope: PropertyScope): GraphqlPropertyDefinitionScope {
  return match(scope)
    .with('all', () => 'ALL' as const)
    .with('system', () => 'SYSTEM' as const)
    .with('team', () => 'TEAM' as const)
    .with('user', () => 'USER' as const)
    .exhaustive(() => 'ALL' as const);
}

/** The REST owner for a definition, or undefined for one this build can't name. */
export function toPropertyOwner(
  owner: PropertyCatalogDefinitionFieldsFragment['owner']
): PropertyOwner | undefined {
  const principalId = owner.principalId;
  return match(owner.scope)
    .with('SYSTEM', (): PropertyOwner => ({ scope: 'system' }))
    .with('USER', () =>
      principalId ? { scope: 'user' as const, user_id: principalId } : undefined
    )
    .with('TEAM', () =>
      principalId ? { scope: 'team' as const, team_id: principalId } : undefined
    )
    .with('DATABASE', () =>
      principalId
        ? { scope: 'database' as const, database_id: principalId }
        : undefined
    )
    .exhaustive(() => undefined);
}

function toOptionValue(
  value: PropertyCatalogOptionFieldsFragment['value']
): PropertyOptionValue | undefined {
  return match(value)
    .with(
      { __typename: 'GraphqlStringPropertyOptionValue' },
      ({ stringValue }): PropertyOptionValue => ({
        type: 'string',
        value: stringValue,
      })
    )
    .with(
      { __typename: 'GraphqlNumberPropertyOptionValue' },
      ({ numberValue }): PropertyOptionValue => ({
        type: 'number',
        value: numberValue,
      })
    )
    .exhaustive(() => undefined);
}

export function toPropertyDefinition(
  definition: PropertyCatalogDefinitionFieldsFragment
): PropertyDefinition | undefined {
  const owner = toPropertyOwner(definition.owner);
  if (!owner) return undefined;
  return {
    id: definition.id,
    owner,
    display_name: definition.displayName,
    data_type: definition.dataType,
    is_multi_select: definition.isMultiSelect,
    specific_entity_type: definition.specificEntityType,
    is_system: definition.isSystem,
    is_metadata: definition.isMetadata,
    created_at: definition.createdAt,
    updated_at: definition.updatedAt,
  };
}

export function toPropertyOption(
  option: PropertyCatalogOptionFieldsFragment
): PropertyOption | undefined {
  const value = toOptionValue(option.value);
  if (!value) return undefined;
  return {
    id: option.id,
    property_definition_id: option.propertyDefinitionId,
    display_order: option.displayOrder,
    value,
    color: option.color,
    created_at: option.createdAt,
    updated_at: option.updatedAt,
  };
}

function toPropertyOptions(
  options: PropertyCatalogOptionFieldsFragment[]
): PropertyOption[] {
  return options.flatMap((option) => toPropertyOption(option) ?? []);
}

function toDefinitionWithOptions(
  definition: DefinitionWithOptions
): PropertyDefinitionResponse | undefined {
  const mapped = toPropertyDefinition(definition);
  if (!mapped) return undefined;
  return {
    definition: mapped,
    property_options: toPropertyOptions(definition.options),
  };
}

function toTagDefinition(
  definition: PropertyCatalogDefinitionFieldsFragment
): PropertyDefinitionDetailResponse | undefined {
  const owner = toPropertyOwner(definition.owner);
  if (!owner) return undefined;
  return {
    ...owner,
    id: definition.id,
    displayName: definition.displayName,
    dataType: definition.dataType,
    isMultiSelect: definition.isMultiSelect,
    specificEntityType: definition.specificEntityType,
    isSystem: definition.isSystem,
    isMetadata: definition.isMetadata,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

function toTagOption(
  option: PropertyCatalogOptionFieldsFragment
): PropertyOptionResponse | undefined {
  const value = toOptionValue(option.value);
  if (!value) return undefined;
  return {
    id: option.id,
    propertyDefinitionId: option.propertyDefinitionId,
    displayOrder: option.displayOrder,
    value,
    color: option.color,
  };
}

function toTagScope(scope: GraphqlTagSet['scope']): TagScope | undefined {
  return match(scope)
    .with('USER', () => 'user' as const)
    .with('TEAM', () => 'team' as const)
    .exhaustive(() => undefined);
}

/** A tag set in the REST shape: `definition` is left out until provisioned. */
export function toTagSet(set: GraphqlTagSet): TagSetResponse | undefined {
  const scope = toTagScope(set.scope);
  if (!scope) return undefined;
  const options = set.options.flatMap((option) => toTagOption(option) ?? []);
  if (!set.definition) return { scope, options };
  const definition = toTagDefinition(set.definition);
  // A provisioned set whose owner this build can't name can't take writes.
  if (!definition) return undefined;
  return { scope, definition, options };
}

type ListDefinitionsArgs = {
  scope: PropertyScope;
  includeOptions: boolean;
  forEntityType?: EntityType;
};

/** Auth failures carry the codes the query client's retry policy reads, as
 * the REST reads' errors did; anything else rejects with the GraphQL error. */
function toQueryError(error: CombinedError): Error {
  const status = error.response?.status;
  if (status === 401)
    return new ThrownResultError([
      { code: 'UNAUTHORIZED', message: error.message },
    ]);
  if (status === 403)
    return new ThrownResultError([
      { code: 'FORBIDDEN', message: error.message },
    ]);
  return error;
}

// urql hashes every other operation key to an integer (its `phash` sums
// integers, and a long enough document or variables reaches any range), so a
// key halfway between two integers is one no hashed operation can have.
let lastCatalogReadKey = 0.5;

/**
 * urql's client answers a query whose key (document and variables) is already
 * in flight with that earlier request's result, `network-only` included. A
 * read sent after a write would then answer from before it: the refetch a
 * write's invalidation starts while an earlier fetch of the same list is
 * pending. Every REST read was a request of its own, so every catalog read
 * gets a key of its own; the document and variables sent are unchanged.
 */
function catalogRequest<Data, Variables extends AnyVariables>(
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables
): GraphQLRequest<Data, Variables> {
  lastCatalogReadKey -= 1;
  return { ...createRequest(document, variables), key: lastCatalogReadKey };
}

async function readCatalog<Data, Variables extends AnyVariables>(
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables
): Promise<Data> {
  const result = await getGraphqlSoupNetworkClient()
    .executeQuery(catalogRequest(document, variables), {
      requestPolicy: 'network-only',
    })
    .toPromise();
  if (result.error) throw toQueryError(result.error);
  if (!result.data) throw new Error('Property catalog read returned no data');
  return result.data;
}

/** The viewer's property definitions, as `GET /properties/definitions` lists them. */
export async function listPropertyDefinitions({
  scope,
  includeOptions,
  forEntityType,
}: ListDefinitionsArgs): Promise<PropertyDefinitionResponse[]> {
  const variables = {
    scope: toGraphqlScope(scope),
    forEntityType: forEntityType ?? null,
  };
  if (includeOptions) {
    const data = await readCatalog(
      PropertyCatalogDefinitionsWithOptionsDocument,
      variables
    );
    return data.user.propertyDefinitions.flatMap(
      (definition) => toDefinitionWithOptions(definition) ?? []
    );
  }
  const data = await readCatalog(PropertyCatalogDefinitionsDocument, variables);
  return data.user.propertyDefinitions.flatMap(
    (definition) => toPropertyDefinition(definition) ?? []
  );
}

/** One definition's options, as `GET /properties/definitions/{id}/options` lists them. */
export async function listPropertyOptions(
  propertyDefinitionId: string
): Promise<PropertyOption[]> {
  const data = await readCatalog(PropertyCatalogOptionsDocument, {
    propertyDefinitionId,
  });
  return toPropertyOptions(data.user.propertyOptions);
}

/** The viewer's tag sets, as `GET /properties/tags` lists them. */
export async function listTagSets(): Promise<TagSetResponse[]> {
  const data = await readCatalog(PropertyCatalogTagSetsDocument, {});
  return data.user.tagSets.flatMap((set) => toTagSet(set) ?? []);
}
