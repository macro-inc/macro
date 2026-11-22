import type { TaskEntityWithProperties } from '@entity';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { PropertyApiValues } from '@property/types';
import type { PropertyDefinitionDetailResponse } from '@service-properties/generated/schemas/propertyDefinitionDetailResponse';
import type { PropertyDefinition } from '@service-storage/generated/schemas/propertyDefinition';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import type { SoupPropertyValue } from '@service-storage/generated/schemas/soupPropertyValue';
import { match } from 'ts-pattern';

/**
 * A task this client created that the view's query has not listed yet. Until
 * the server answers, `pending` is true and the id is temporary: the row is
 * shown dimmed and can't be opened, selected or acted on.
 */
export type OptimisticTask = {
  entity: TaskEntityWithProperties;
  pending: boolean;
};

export type OptimisticTaskDefinition =
  | PropertyDefinition
  | PropertyDefinitionDetailResponse;

export type OptimisticTaskInput = {
  /** Temporary until the server answers (`crypto.randomUUID()`). */
  id: string;
  title: string;
  ownerId: string;
  properties: ReadonlyArray<readonly [string, PropertyApiValues]>;
  definitions: ReadonlyMap<string, OptimisticTaskDefinition>;
  now: Date;
};

/**
 * The row a created task shows before the server lists it, with the values the
 * composer sent. The server sets Status to Not started when none is sent.
 */
export function buildOptimisticTask(
  input: OptimisticTaskInput
): TaskEntityWithProperties {
  const timestamp = input.now.toISOString();
  const values: Array<readonly [string, PropertyApiValues]> = [
    ...input.properties,
  ];
  // A cleared Status is not sent either.
  if (
    !values.some(
      ([id, value]) =>
        id === SYSTEM_PROPERTY_IDS.STATUS && soupPropertyValue(value)
    )
  ) {
    values.push([
      SYSTEM_PROPERTY_IDS.STATUS,
      {
        valueType: 'SELECT_STRING',
        values: [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED],
      },
    ]);
  }

  const properties = values.flatMap(([definitionId, value]): SoupProperty[] => {
    const soupValue = soupPropertyValue(value);
    if (!soupValue) return [];
    return [
      {
        id: `${input.id}:${definitionId}`,
        definition: soupDefinition(
          definitionId,
          value,
          input.definitions.get(definitionId),
          timestamp
        ),
        value: soupValue,
      },
    ];
  });

  return {
    id: input.id,
    name: input.title,
    ownerId: input.ownerId,
    type: 'document',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
    createdAt: timestamp,
    updatedAt: timestamp,
    properties,
  };
}

/** A composer value as Soup stores it; nothing for an empty value. */
function soupPropertyValue(value: PropertyApiValues): SoupPropertyValue {
  return match(value)
    .with({ valueType: 'STRING' }, ({ value }) =>
      value ? { type: 'String' as const, value } : null
    )
    .with({ valueType: 'NUMBER' }, ({ value }) =>
      value === null || Number.isNaN(value)
        ? null
        : { type: 'Number' as const, value }
    )
    .with({ valueType: 'BOOLEAN' }, ({ value }) =>
      value === null ? null : { type: 'Boolean' as const, value }
    )
    .with({ valueType: 'DATE' }, ({ value }) =>
      value && !Number.isNaN(value.getTime())
        ? { type: 'Date' as const, value: value.toISOString() }
        : null
    )
    .with({ valueType: 'DATE_RANGE' }, ({ value }) =>
      value
        ? {
            type: 'DateRange' as const,
            value: {
              start: value.start.toISOString(),
              end: value.end.toISOString(),
            },
          }
        : null
    )
    .with(
      { valueType: 'SELECT_STRING' },
      { valueType: 'SELECT_NUMBER' },
      (v) =>
        v.values?.length
          ? { type: 'SelectOption' as const, value: v.values }
          : null
    )
    .with({ valueType: 'ENTITY' }, ({ refs }) =>
      refs?.length
        ? {
            type: 'EntityReference' as const,
            value: refs.map((ref) => ({
              entity_id: ref.entity_id,
              entity_type: ref.entity_type,
            })),
          }
        : null
    )
    .with({ valueType: 'LINK' }, ({ values }) =>
      values?.length ? { type: 'Link' as const, value: values } : null
    )
    .exhaustive();
}

function soupDefinition(
  id: string,
  value: PropertyApiValues,
  definition: OptimisticTaskDefinition | undefined,
  timestamp: string
): PropertyDefinition {
  if (!definition) {
    // Project and Status are system properties the composer may not list.
    return {
      id,
      display_name: '',
      data_type: value.valueType,
      is_metadata: false,
      is_multi_select: value.valueType === 'ENTITY',
      is_system: true,
      owner: { scope: 'system' },
      specific_entity_type: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
  }
  if ('data_type' in definition) return definition;
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    dataType,
    displayName,
    id: _id,
    isMetadata,
    isMultiSelect,
    isSystem,
    specificEntityType,
    ...owner
  } = definition;
  return {
    id,
    display_name: displayName,
    data_type: dataType,
    is_metadata: isMetadata,
    is_multi_select: isMultiSelect,
    is_system: isSystem,
    owner,
    specific_entity_type: specificEntityType ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}
