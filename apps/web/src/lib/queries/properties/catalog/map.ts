/**
 * Conversions between the property catalog's GraphQL records and the REST
 * shapes its callers consume, and from REST-shaped write requests to GraphQL
 * inputs. Reads return the shapes `GET /properties/*` returned, so callers
 * keep their types while the data comes from the normalized cache.
 */

import type { AddPropertyOptionRequest } from '@service-properties/generated/schemas/addPropertyOptionRequest';
import type { CreatePropertyDefinitionRequest } from '@service-properties/generated/schemas/createPropertyDefinitionRequest';
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
import type {
  AddPropertyOptionInput,
  CreatePropertyDefinitionInput,
  GraphqlPropertyDefinitionScope,
  GraphqlTagScope,
  PropertyCatalogDefinitionFieldsFragment,
  PropertyCatalogOptionFieldsFragment,
  PropertyCatalogTagSetFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';

export type CatalogDefinitionWithOptions =
  PropertyCatalogDefinitionFieldsFragment & {
    options: PropertyCatalogOptionFieldsFragment[];
  };

export function toGraphqlDefinitionScope(
  scope: PropertyScope
): GraphqlPropertyDefinitionScope {
  return match(scope)
    .with('all', () => 'ALL' as const)
    .with('system', () => 'SYSTEM' as const)
    .with('team', () => 'TEAM' as const)
    .with('user', () => 'USER' as const)
    .exhaustive(() => 'ALL' as const);
}

export function toGraphqlTagScope(scope: TagScope): GraphqlTagScope {
  return scope === 'team' ? 'TEAM' : 'USER';
}

function toTagScope(
  scope: PropertyCatalogTagSetFieldsFragment['scope']
): TagScope | undefined {
  return match(scope)
    .with('USER', () => 'user' as const)
    .with('TEAM', () => 'team' as const)
    .exhaustive(() => undefined);
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

/**
 * Options in the server's order. The server sorts by display order first, so
 * a stable sort leaves its lists as they are and places an option the cache
 * inserted or reordered locally where the server will put it.
 */
export function byDisplayOrder<T extends { displayOrder: number }>(
  options: readonly T[]
): T[] {
  return [...options].sort((a, b) => a.displayOrder - b.displayOrder);
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
    color: option.color ?? null,
    created_at: option.createdAt,
    updated_at: option.updatedAt,
  };
}

export function toPropertyOptions(
  options: readonly PropertyCatalogOptionFieldsFragment[]
): PropertyOption[] {
  return byDisplayOrder(options).flatMap(
    (option) => toPropertyOption(option) ?? []
  );
}

export function toDefinitionWithOptions(
  definition: CatalogDefinitionWithOptions
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

export function toTagOption(
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

/** A tag set in the REST shape: `definition` is left out until provisioned. */
export function toTagSet(
  set: PropertyCatalogTagSetFieldsFragment
): TagSetResponse | undefined {
  const scope = toTagScope(set.scope);
  if (!scope) return undefined;
  const options = byDisplayOrder(set.options).flatMap(
    (option) => toTagOption(option) ?? []
  );
  if (!set.definition) return { scope, options };
  const definition = toTagDefinition(set.definition);
  // A provisioned set whose owner this build can't name can't take writes.
  if (!definition) return undefined;
  return { scope, definition, options };
}

/** The GraphQL create input for a REST-shaped create request. */
export function toCreateDefinitionInput(
  request: CreatePropertyDefinitionRequest
): CreatePropertyDefinitionInput {
  const base = {
    scope: request.scope === 'team' ? ('TEAM' as const) : ('USER' as const),
    displayName: request.display_name,
  };
  return match(request.data_type)
    .with({ type: 'boolean' }, () => ({
      ...base,
      dataType: 'BOOLEAN' as const,
    }))
    .with({ type: 'date' }, () => ({ ...base, dataType: 'DATE' as const }))
    .with({ type: 'date_range' }, () => ({
      ...base,
      dataType: 'DATE_RANGE' as const,
    }))
    .with({ type: 'number' }, () => ({ ...base, dataType: 'NUMBER' as const }))
    .with({ type: 'string' }, () => ({ ...base, dataType: 'STRING' as const }))
    .with({ type: 'select_string' }, (type) => ({
      ...base,
      dataType: 'SELECT_STRING' as const,
      isMultiSelect: type.multi,
      options: type.options.map((option) => ({
        displayOrder: option.display_order,
        value: { string: option.value },
      })),
    }))
    .with({ type: 'select_number' }, (type) => ({
      ...base,
      dataType: 'SELECT_NUMBER' as const,
      isMultiSelect: type.multi,
      options: type.options.map((option) => ({
        displayOrder: option.display_order,
        value: { number: option.value },
      })),
    }))
    .with({ type: 'entity' }, (type) => ({
      ...base,
      dataType: 'ENTITY' as const,
      isMultiSelect: type.multi,
      specificEntityType: type.specific_type ?? null,
    }))
    .with({ type: 'link' }, (type) => ({
      ...base,
      dataType: 'LINK' as const,
      isMultiSelect: type.multi,
    }))
    .exhaustive((unknown) => {
      // A type this build cannot send: refuse rather than create the wrong one.
      throw new Error(`Unsupported property type: ${JSON.stringify(unknown)}`);
    });
}

/** The GraphQL add input for a REST-shaped add request. */
export function toAddOptionInput(
  propertyDefinitionId: string,
  request: AddPropertyOptionRequest
): AddPropertyOptionInput {
  return request.type === 'select_number'
    ? {
        propertyDefinitionId,
        displayOrder: request.option.display_order,
        value: { number: request.option.value },
      }
    : {
        propertyDefinitionId,
        displayOrder: request.option.display_order,
        value: { string: request.option.value },
        ...(request.option.color != null
          ? { color: request.option.color }
          : {}),
      };
}

/** The value record the server returns for an option value input. */
export function optionValueRecord(
  value: AddPropertyOptionInput['value']
): PropertyCatalogOptionFieldsFragment['value'] {
  return 'number' in value && value.number !== undefined
    ? {
        __typename: 'GraphqlNumberPropertyOptionValue',
        numberValue: value.number,
      }
    : {
        __typename: 'GraphqlStringPropertyOptionValue',
        stringValue: value.string ?? '',
      };
}
