import {
  openPropertyEditor,
  type PropertyEditorEntity,
} from '@property/editor/state/propertyEditor';
import { canTagEntity } from '@property/tags/entityTagging';

/** Open the tag editor for entities supported by the tagging domain. */
export const makeAddTagAction = () => {
  const canExecute = (entity: PropertyEditorEntity): boolean =>
    canTagEntity(entity);

  const execute = (
    entities: PropertyEditorEntity[],
    options?: Parameters<typeof openPropertyEditor>[3]
  ) => {
    if (entities.length === 0 || !entities.every(canExecute)) return;
    openPropertyEditor(entities, 'tag', undefined, options);
  };

  return { canExecute, execute };
};
