import { Permissions } from '@core/component/SharePermissions';
import { ShareModal } from '@core/component/TopBar/ShareButton';
import { itemToBlockName } from '@core/constant/allBlocks';
import { type DialogHandle, openDialog } from '@ui';
import { type ComponentProps, Suspense } from 'solid-js';
import {
  isShareableEntityType,
  type ShareableEntityData,
} from './shareable-entity';

function SuspendedShareModal(props: ComponentProps<typeof ShareModal>) {
  return (
    <Suspense>
      <ShareModal {...props} />
    </Suspense>
  );
}

/** Opens the share modal for an entity outside of its block. */
export const openGlobalShareModal = (props: {
  entity: ShareableEntityData;
}): DialogHandle | undefined => {
  const { entity } = props;
  if (!isShareableEntityType(entity.type)) {
    console.warn(`Cannot share entity of type ${entity.type} - not supported`);
    return;
  }

  return openDialog(SuspendedShareModal, {
    id: entity.id,
    blockAlias: itemToBlockName(entity) ?? 'unknown',
    itemType: entity.type,
    name: entity.name,
    userPermissions: Permissions.OWNER,
    owner: entity.ownerId,
  });
};
