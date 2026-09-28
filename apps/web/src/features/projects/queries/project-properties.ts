import { soupPropertyToProperty } from '@entity/extractors-property/property-helpers';
import { entityPropertyFromApi } from '@property/api/converters';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import {
  selectablePropertyOptions,
  withProjectStatusOptions,
} from '@property/utils/select-options';
import type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';

/** Same left-to-right order as the task composer and project detail. */
export const PROJECT_PROPERTY_IDS: string[] = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
];

/** A project's values for those properties, in composer order. */
export function projectProperties(properties: SoupProperty[]): Property[] {
  return properties
    .filter((property) => PROJECT_PROPERTY_IDS.includes(property.definition.id))
    .map(soupPropertyToProperty)
    .map(withProjectStatusOptions)
    .sort(
      (left, right) =>
        PROJECT_PROPERTY_IDS.indexOf(left.propertyDefinitionId) -
        PROJECT_PROPERTY_IDS.indexOf(right.propertyDefinitionId)
    );
}

export function projectDefinitionProperties(
  items: PropertyDefinitionResponse[]
): Property[] {
  const byId = new Map(
    items.map((item) => [
      'definition' in item ? item.definition.id : item.id,
      item,
    ])
  );
  return PROJECT_PROPERTY_IDS.flatMap((id) => {
    const item = byId.get(id);
    if (!item) return [];
    const definition = 'definition' in item ? item.definition : item;
    const property = withProjectStatusOptions(
      entityPropertyFromApi({
        definition,
        options: 'property_options' in item ? item.property_options : [],
        value: null,
        property: {
          id: definition.id,
          property_definition_id: definition.id,
          entity_id: '',
          entity_type: 'INITIATIVE',
          created_at: definition.created_at,
          updated_at: definition.updated_at,
        },
      })
    );
    return [{ ...property, options: selectablePropertyOptions(property) }];
  });
}
