import type { EntityData } from '@entity';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { macroEntityToPropertyEntityType } from '@property/utils';
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

    try {
      await mutation.mutateAsync({
        properties: entities.map((e) => ({
          entityId: e.id,
          entityType: macroEntityToPropertyEntityType(e),
          property,
          apiValues: value,
        })),
      });
      return true;
    } catch {
      return false;
    }
  };
}
