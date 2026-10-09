/**
 * Builders for optimistic `setEntityProperty` GraphQL responses. The
 * optimistic payload must exactly match the mutation selection
 * (`SoupPropertyFields`) so the normalized cache can apply it to the same
 * property record referenced by soup query results.
 */

import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
// The concrete module (not the `@property/utils` barrel): the barrel pulls
// in UI/side-effect imports that break in non-browser test environments.
import { isInstantiatedProperty } from '@property/utils/typeGuards';
import type { SoupPropertyFieldsFragment } from '../../service-clients/service-storage/graphql/generated/graphql';

type GraphqlPropertyValue = NonNullable<SoupPropertyFieldsFragment['value']>;

/**
 * `PropertyApiValues` → the GraphQL property value as the server would
 * return it. `null` mirrors the REST behavior of clearing the value when
 * the variant carries nothing.
 */
export function apiValuesToGraphqlPropertyValue(
  apiValues: PropertyApiValues
): GraphqlPropertyValue | null {
  switch (apiValues.valueType) {
    case 'STRING':
      return apiValues.value != null
        ? {
            __typename: 'GraphqlStringPropertyValue',
            stringValue: apiValues.value,
          }
        : null;
    case 'NUMBER':
      return apiValues.value != null
        ? {
            __typename: 'GraphqlNumberPropertyValue',
            numberValue: apiValues.value,
          }
        : null;
    case 'BOOLEAN':
      return apiValues.value != null
        ? {
            __typename: 'GraphqlBooleanPropertyValue',
            boolValue: apiValues.value,
          }
        : null;
    case 'DATE':
      return apiValues.value != null
        ? {
            __typename: 'GraphqlDatePropertyValue',
            dateValue: apiValues.value.toISOString(),
          }
        : null;
    case 'SELECT_STRING':
    case 'SELECT_NUMBER':
      return apiValues.values != null && apiValues.values.length > 0
        ? {
            __typename: 'GraphqlSelectOptionPropertyValue',
            optionIds: apiValues.values,
          }
        : null;
    case 'ENTITY':
      return apiValues.refs != null && apiValues.refs.length > 0
        ? {
            __typename: 'GraphqlEntityReferencePropertyValue',
            references: apiValues.refs.map((ref) => ({
              entityId: ref.entity_id,
              entityType: ref.entity_type,
              specificMessageId: ref.specific_message_id ?? null,
            })),
          }
        : null;
    case 'LINK':
      return apiValues.values != null && apiValues.values.length > 0
        ? {
            __typename: 'GraphqlLinkPropertyValue',
            urls: apiValues.values,
          }
        : null;
    default: {
      const exhaustiveCheck: never = apiValues;
      throw new Error(
        `Unsupported value type: ${(exhaustiveCheck as { valueType: string }).valueType}`
      );
    }
  }
}

/**
 * The property record as the server would return it, for an already-persisted
 * assignment carrying `value`.
 */
function optimisticPropertyRecord(
  property: Property | PropertyDefinitionDomain,
  value: GraphqlPropertyValue | null,
  id: string
): SoupPropertyFieldsFragment {
  return {
    id,
    propertyDefinitionId: isInstantiatedProperty(property)
      ? property.propertyDefinitionId
      : property.id,
    displayName: property.displayName,
    dataType: property.valueType,
    isMultiSelect: property.isMultiSelect,
    specificEntityType: property.specificEntityType ?? null,
    isSystem: isInstantiatedProperty(property)
      ? (property.isSystemProperty ?? false)
      : property.isSystem,
    isMetadata: property.isMetadata ?? false,
    value,
  };
}

const TEMPORARY_PROPERTY_PREFIX = 'optimistic-property:';

/** Temporary assignments must retain a response-derived parent-list recipe. */
export function isTemporaryGraphqlProperty(id: string): boolean {
  return id.startsWith(TEMPORARY_PROPERTY_PREFIX);
}

function isPersistedAssignmentId(id: string, definitionId: string): boolean {
  return (
    id !== definitionId &&
    !id.startsWith('pending:') &&
    !isTemporaryGraphqlProperty(id)
  );
}

type PropertyTarget = { entityType: string; entityId: string };

function optimisticPropertyId(
  property: Property | PropertyDefinitionDomain,
  target?: PropertyTarget,
  assignmentId?: string
): string | undefined {
  const definitionId = isInstantiatedProperty(property)
    ? property.propertyDefinitionId
    : property.id;
  const id =
    assignmentId ??
    (isInstantiatedProperty(property) ? property.propertyId : undefined);
  if (id && isPersistedAssignmentId(id, definitionId)) return id;
  return target
    ? `${TEMPORARY_PROPERTY_PREFIX}${target.entityType}:${target.entityId}:${definitionId}`
    : undefined;
}

/**
 * New assignments use a target-scoped temporary ID, never a shared definition
 * ID. Callers supplying a target must also install a response-derived list
 * recipe, so commit replaces the temporary link with the server's assignment.
 */
export function buildOptimisticSetEntityProperty(
  property: Property | PropertyDefinitionDomain,
  apiValues: PropertyApiValues,
  target?: PropertyTarget
): SoupPropertyFieldsFragment | undefined {
  const id = optimisticPropertyId(property, target);
  if (!id) return undefined;
  return optimisticPropertyRecord(
    property,
    apiValuesToGraphqlPropertyValue(apiValues),
    id
  );
}

/**
 * Optimistic payload for a multi-select property reaching `optionIds`.
 * First assignments use the same target-scoped identity and require the same
 * response-derived parent link as a full-value property save.
 */
export function buildOptimisticEntityPropertyOptions(
  property: Property | PropertyDefinitionDomain,
  optionIds: readonly string[],
  assignmentId?: string,
  target?: PropertyTarget
): SoupPropertyFieldsFragment | undefined {
  const id = optimisticPropertyId(property, target, assignmentId);
  if (!id) return undefined;
  return optimisticPropertyRecord(
    property,
    optionIds.length > 0
      ? {
          __typename: 'GraphqlSelectOptionPropertyValue',
          optionIds: [...optionIds],
        }
      : null,
    id
  );
}
