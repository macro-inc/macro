import { useChannelPictureEditor } from '@channel/channel-picture';
import { canEditChannelIdentity, type EntityData } from '@entity/types/entity';
import { createCachedChannelPicture } from '@queries/channel/picture';

/**
 * Set or clear a channel's picture.
 *
 * Gated exactly like Rename — any participant of a named channel — because the
 * picture is part of the same channel identity the server lets members edit.
 */
export const makeChannelPictureAction = () => {
  const editor = useChannelPictureEditor();
  const cachedPictureId = createCachedChannelPicture();

  const canExecute = (entity: EntityData): boolean =>
    canEditChannelIdentity(entity) && !editor.isPending();

  /**
   * Whether removal is worth offering. The id comes from cache because a menu
   * is built synchronously, and the read is tracked, so a menu built before the
   * channel's avatar resolved gains the item once the picture arrives.
   */
  const hasPicture = (entity: EntityData): boolean =>
    canExecute(entity) && !!cachedPictureId(entity.id);

  // Single entity only: the file picker uploads one image for one channel.
  const execute = (entities: EntityData[]) => {
    const entity = entities[0];
    if (!entity || entities.length !== 1 || !canExecute(entity)) return;
    editor.pickFile(entity.id);
  };

  const remove = (entities: EntityData[]) => {
    const entity = entities[0];
    if (!entity || entities.length !== 1 || !hasPicture(entity)) return;
    editor.remove(entity.id);
  };

  return { canExecute, hasPicture, execute, remove };
};
