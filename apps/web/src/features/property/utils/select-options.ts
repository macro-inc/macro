import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '../identifiers';
import type { Property, PropertyOption } from '../types';

const PROJECT_STATUS_OPTION_IDS = [
  PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
  PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
  PROPERTY_OPTION_IDS.STATUS.COMPLETED,
];

/** Projects share status identifiers with tasks, but have a smaller lifecycle. */
export function withProjectStatusOptions(property: Property): Property {
  return property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS
    ? { ...property, allowedOptionIds: PROJECT_STATUS_OPTION_IDS }
    : property;
}

/** A select whose labels come from its definition rather than its own copy. */
export function needsDefinitionOptions(property: Property): boolean {
  return (
    (property.valueType === 'SELECT_STRING' ||
      property.valueType === 'SELECT_NUMBER') &&
    property.options === undefined &&
    property.isTag !== true
  );
}

/**
 * An item's copy of a custom select carries only option IDs; Status and
 * Priority get their options where they are mapped. Give the others their
 * definition's options so their values show by name. Returns the same array
 * when nothing changes.
 */
export function withDefinitionOptions(
  properties: Property[],
  optionsByDefinition: ReadonlyMap<string, PropertyOption[]>
): Property[] {
  let changed = false;
  const resolved = properties.map((property) => {
    if (!needsDefinitionOptions(property)) return property;
    const options = optionsByDefinition.get(property.propertyDefinitionId);
    if (!options) return property;
    changed = true;
    return { ...property, options };
  });
  return changed ? resolved : properties;
}

export function selectablePropertyOptions(
  property: Property,
  options: PropertyOption[] = property.options ?? []
): PropertyOption[] {
  const allowed = property.allowedOptionIds;
  return allowed
    ? options.filter((option) => allowed.includes(option.id))
    : options;
}
