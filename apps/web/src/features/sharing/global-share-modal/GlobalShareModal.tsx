import { Permissions } from '@core/component/SharePermissions';
import { openShareModal } from '@core/component/TopBar/shareModal';
import { itemToBlockName } from '@core/constant/allBlocks';
import type { DialogHandle } from '@ui';
import {
  isShareableEntityType,
  type ShareableEntityData,
} from './shareable-entity';

/** Opens the share modal for an entity outside of its block. */
export const openGlobalShareModal = (props: {
  entity: ShareableEntityData;
}): DialogHandle | undefined => {
  const { entity } = props;
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
