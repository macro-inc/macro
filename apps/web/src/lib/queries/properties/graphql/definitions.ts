import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { PropertyOwner } from '@service-properties/generated/schemas/propertyOwner';
import type { PropertyScope } from '@service-properties/generated/schemas/propertyScope';
import {
  type GraphqlPropertyDefinitionScope,
  PropertyDefinitionsDocument,
  type PropertyDefinitionsQuery,
  type PropertyOptionFieldsFragment,
  PropertyOptionsDocument,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { match } from 'ts-pattern';

export type PropertyDefinitionsQueryParams = {
  scope: PropertyScope;
  includeOptions: boolean;
  forEntityType?: EntityType;
};

type GraphqlDefinition =
  PropertyDefinitionsQuery['user']['propertyDefinitions'][number];

const DEFINITION_SCOPES = {
  user: 'USER',
  team: 'TEAM',
  system: 'SYSTEM',
  all: 'ALL',
} satisfies Record<PropertyScope, GraphqlPropertyDefinitionScope>;

function mapDefinitionOwner(owner: GraphqlDefinition['owner']): PropertyOwner {
  return match(owner.scope)
    .with('SYSTEM', () => ({ scope: 'system' as const }))
    .with('USER', () => {
      if (owner.principalId === null) {
        throw new Error('User property definition has no owner');
      }
      return { scope: 'user' as const, user_id: owner.principalId };
    })
    .with('TEAM', () => {
      if (owner.principalId === null) {
        throw new Error('Team property definition has no owner');
      }
      return { scope: 'team' as const, team_id: owner.principalId };
    })
    .exhaustive();
}

/** Keep the shared property picker model while reading typed GraphQL options. */
export function mapGraphqlPropertyOption(
  option: PropertyOptionFieldsFragment
): PropertyOption {
  return {
    id: option.id,
    property_definition_id: option.propertyDefinitionId,
    display_order: option.displayOrder,
    color: option.color,
    created_at: option.createdAt,
    updated_at: option.updatedAt,
    value: match(option.value)
      .with({ __typename: 'GraphqlStringPropertyOptionValue' }, (value) => ({
        type: 'string' as const,
        value: value.stringValue,
      }))
      .with({ __typename: 'GraphqlNumberPropertyOptionValue' }, (value) => ({
        type: 'number' as const,
        value: value.numberValue,
      }))
      .exhaustive(),
  };
}

/** Adapt definition metadata without substituting assignment IDs for definitions. */
export function mapGraphqlPropertyDefinition(
  definition: GraphqlDefinition,
  includeOptions: boolean
): PropertyDefinitionResponse {
  const property: PropertyDefinition = {
    id: definition.id,
    display_name: definition.displayName,
    data_type: definition.dataType,
    is_multi_select: definition.isMultiSelect,
    specific_entity_type: definition.specificEntityType,
    is_system: definition.isSystem,
    is_metadata: definition.isMetadata,
    created_at: definition.createdAt,
    updated_at: definition.updatedAt,
    owner: mapDefinitionOwner(definition.owner),
  };
  return includeOptions
    ? {
        definition: property,
        property_options: (definition.options ?? []).map(
          mapGraphqlPropertyOption
        ),
      }
    : property;
}

/** Network read used by the existing shared query and invalidation lifecycle. */
export async function fetchGraphqlPropertyDefinitions(
  params: PropertyDefinitionsQueryParams
): Promise<PropertyDefinitionResponse[]> {
  const response = await getGraphqlSoupClient()
    .query(
      PropertyDefinitionsDocument,
      {
        scope: DEFINITION_SCOPES[params.scope],
        forEntityType: params.forEntityType,
        includeOptions: params.includeOptions,
      },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  if (response.error) throw response.error;
  if (!response.data) throw new Error('Property definitions were not returned');
  return response.data.user.propertyDefinitions.map((definition) =>
    mapGraphqlPropertyDefinition(definition, params.includeOptions)
  );
}

/** Read only options the caller is authorized to see. */
export async function fetchGraphqlPropertyOptions(
  propertyDefinitionId: string
): Promise<PropertyOption[]> {
  const response = await getGraphqlSoupClient()
    .query(
      PropertyOptionsDocument,
      { propertyDefinitionId },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  if (response.error) throw response.error;
  if (!response.data) throw new Error('Property options were not returned');
  return response.data.user.propertyOptions.map(mapGraphqlPropertyOption);
}
