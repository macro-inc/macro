import { isTaskEntity } from '@entity';
import type { PropertyEditorEntity } from '@property/editor/state/propertyEditor';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { macroEntityToPropertyEntityType } from '@property/utils';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';

function propertyEditorEntityType(entity: PropertyEditorEntity) {
  if ('entityType' in entity) return entity.entityType;
  if (isTaskEntity(entity)) return 'TASK';
  return macroEntityToPropertyEntityType(entity);
}

export function useSavePropertyForMultiEntitites() {
  const mutation = useBulkSaveEntityPropertiesMutation();
  return async (
    entities: PropertyEditorEntity[],
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
          entityType: propertyEditorEntityType(e),
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
