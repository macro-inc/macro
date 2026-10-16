import { Permissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import { openShareModal } from '@core/component/TopBar/shareModal';
import { itemToBlockName } from '@core/constant/allBlocks';
import type { DialogHandle } from '@ui';
import {
  isShareableEntityType,
  type ShareableEntityData,
} from './shareable-entity';

/** Opens the share modal for an entity outside of its block. */
export const openGlobalShareModal = async (props: {
  entity: ShareableEntityData;
}): Promise<DialogHandle | undefined> => {
  const { entity } = props;
  // A form shares its respond link and audience at its own access level.
  if (entity.type === 'form') {
    try {
      const { openFormShareModal } = await import(
        '@app/features/block-form/form-global-sharing'
      );
      return await openFormShareModal(entity.id);
    } catch {
      toast.failure('This form’s sharing couldn’t be loaded.');
      return;
    }
  }
  if (!isShareableEntityType(entity.type)) {
    console.warn(`Cannot share entity of type ${entity.type} - not supported`);
    return;
  }

  return openShareModal({
    id: entity.id,
    blockAlias: itemToBlockName(entity) ?? 'unknown',
    itemType: entity.type,
    name: entity.name,
    userPermissions: Permissions.OWNER,
    owner: entity.ownerId,
  });
};
