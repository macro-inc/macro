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

export function selectablePropertyOptions(
  property: Property,
  options: PropertyOption[] = property.options ?? []
): PropertyOption[] {
  const allowed = property.allowedOptionIds;
  return allowed
    ? options.filter((option) => allowed.includes(option.id))
    : options;
}
