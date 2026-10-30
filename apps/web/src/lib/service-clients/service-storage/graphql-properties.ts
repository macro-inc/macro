import { match } from 'ts-pattern';
import type { SoupProperty } from './generated/schemas/soupProperty';
import type { SoupPropertyFieldsFragment } from './graphql/generated/graphql';

type GraphqlPropertyValue = NonNullable<SoupPropertyFieldsFragment['value']>;

function mapGraphqlPropertyValue(
  value: GraphqlPropertyValue | null | undefined
) {
  if (!value) return value;

  return match(value)
    .with({ __typename: 'GraphqlBooleanPropertyValue' }, ({ boolValue }) => ({
      type: 'Boolean' as const,
      value: boolValue,
    }))
    .with({ __typename: 'GraphqlNumberPropertyValue' }, ({ numberValue }) => ({
      type: 'Number' as const,
      value: numberValue,
    }))
    .with({ __typename: 'GraphqlStringPropertyValue' }, ({ stringValue }) => ({
      type: 'String' as const,
      value: stringValue,
    }))
    .with({ __typename: 'GraphqlDatePropertyValue' }, ({ dateValue }) => ({
      type: 'Date' as const,
      value: dateValue,
    }))
    .with(
      { __typename: 'GraphqlDateRangePropertyValue' },
      ({ rangeStart, rangeEnd }) => ({
        type: 'DateRange' as const,
        value: { start: rangeStart, end: rangeEnd },
      })
    )
    .with(
      { __typename: 'GraphqlSelectOptionPropertyValue' },
      ({ optionIds }) => ({
        type: 'SelectOption' as const,
        value: optionIds,
      })
    )
    .with(
      { __typename: 'GraphqlEntityReferencePropertyValue' },
      ({ references }) => ({
        type: 'EntityReference' as const,
        value: references.map((reference) => ({
          entity_id: reference.entityId,
          entity_type: reference.entityType,
          specific_message_id: reference.specificMessageId ?? undefined,
        })),
      })
    )
    .with({ __typename: 'GraphqlLinkPropertyValue' }, ({ urls }) => ({
      type: 'Link' as const,
      value: urls,
    }))
    .exhaustive(() => null);
}

/** Maps GraphQL property fragments to the shared Soup property shape. */
export function mapGraphqlProperties(
  properties: SoupPropertyFieldsFragment[]
): SoupProperty[] {
  return properties.map((property) => ({
    id: property.id,
    definition: {
      id: property.propertyDefinitionId,
      display_name: property.displayName,
      data_type: property.dataType,
      is_multi_select: property.isMultiSelect,
      specific_entity_type: property.specificEntityType ?? null,
      is_system: property.isSystem,
      is_metadata: property.isMetadata,
      owner: { scope: 'system' as const },
      created_at: '',
      updated_at: '',
    },
    value: mapGraphqlPropertyValue(property.value),
  }));
}
