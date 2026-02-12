import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@core/component/Properties/types';
import {
  isInstantiatedProperty,
  macroEntityToPropertyEntityType,
} from '@core/component/Properties/utils';
import type { EntityData } from '@entity';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';

export function useSavePropertyForMultiEntitites() {
  const mutation = useBulkSaveEntityPropertiesMutation();
  return async (
    entities: EntityData[],
    property: Property | PropertyDefinitionDomain,
    value: PropertyApiValues
  ) => {
    if (entities.length === 0) {
      console.error('saveProperties Error: no selected entities');
    }

    const definitionId = isInstantiatedProperty(property)
      ? property.propertyDefinitionId
      : property.id;

    const propList = entities.map((e) => ({
      entityId: e.id,
      entityType: macroEntityToPropertyEntityType(e),
      property: { id: definitionId, isMultiSelect: property.isMultiSelect },
      apiValues: value,
    }));

    try {
      await mutation.mutateAsync({ properties: propList });
      return true;
    } catch {
      return false;
    }
  };
}
