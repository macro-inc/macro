import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { ShareModal } from '@core/component/TopBar/ShareButton';
import { Permissions } from '@core/component/SharePermissions';
import { itemToBlockName } from '@core/constant/allBlocks';
import type { BlockAlias, BlockName } from '@core/block';
import type { ItemType } from '@service-storage/client';
import type { EntityData } from '@entity';
import { createSignal, Show } from 'solid-js';

type ShareableEntityType = 'document' | 'chat' | 'project';

export type ShareableEntityData = Extract<
  EntityData,
  { type: ShareableEntityType }
>;

export type GlobalShareModalProps = {
  entity: ShareableEntityData;
  onClose?: () => void;
};

const [globalModalProps, setGlobalModalProps] =
  createSignal<GlobalShareModalProps | null>(null);
const [modalOpen, setModalOpen] = createControlledOpenSignal(false, {
  id: 'global-share',
});

export const isShareableEntityType = (
  type: EntityData['type']
): type is ShareableEntityType => {
  return type === 'document' || type === 'chat' || type === 'project';
};

const getEntityBlockAlias = (
  entity: ShareableEntityData
): BlockName | BlockAlias => {
  return itemToBlockName(entity) ?? 'unknown';
};

const getEntityItemType = (entity: ShareableEntityData): ItemType => {
  return entity.type;
};

export const openGlobalShareModal = (props: GlobalShareModalProps) => {
  if (!isShareableEntityType(props.entity.type)) {
    console.warn(
      `Cannot share entity of type ${props.entity.type} - not supported`
    );
    return;
  }
  setGlobalModalProps(props);
  setModalOpen(true);
};

export const closeGlobalShareModal = () => {
  const props = globalModalProps();
  setModalOpen(false);
  setGlobalModalProps(null);
  props?.onClose?.();
};

/**
 * Global share modal component - should be mounted once at the app level
 */
export const GlobalShareModal = () => {
  const handleSetIsOpen = (isOpen: boolean) => {
    if (!isOpen) {
      closeGlobalShareModal();
    }
    setModalOpen(isOpen);
  };

  return (
    <Show when={globalModalProps()}>
      {(propsAccessor) => {
        const entity = () => propsAccessor().entity;

        return (
          <ShareModal
            isSharePermOpen={modalOpen()}
            setIsSharePermOpen={handleSetIsOpen}
            id={entity().id}
            blockAlias={getEntityBlockAlias(entity())}
            itemType={getEntityItemType(entity())}
            name={entity().name}
            userPermissions={Permissions.OWNER}
            owner={entity().ownerId}
          />
        );
      }}
    </Show>
  );
};
