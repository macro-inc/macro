import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { ShareModal } from '@core/component/TopBar/ShareButton';
import { Permissions } from '@core/component/SharePermissions';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { BlockAlias, BlockName } from '@core/block';
import type { ItemType } from '@service-storage/client';
import type { EntityData } from '@entity';
import { createSignal, Show } from 'solid-js';

type ShareableEntityType = 'document' | 'chat' | 'project';

export type GlobalShareModalProps = {
  entity: EntityData;
  onClose?: () => void;
};

const [globalModalProps, setGlobalModalProps] =
  createSignal<GlobalShareModalProps | null>(null);
const [modalOpen, setModalOpen] = createControlledOpenSignal();

/**
 * Check if an entity type can be shared
 */
export const isShareableEntityType = (
  type: EntityData['type']
): type is ShareableEntityType => {
  return type === 'document' || type === 'chat' || type === 'project';
};

/**
 * Get the block alias for an entity (used for URL building in share modal)
 */
const getEntityBlockAlias = (entity: EntityData): BlockName | BlockAlias => {
  if (entity.type === 'document') {
    const { fileType, subType } = entity;
    return fileTypeToBlockName(subType?.type ?? fileType);
  }
  return entity.type;
};

/**
 * Get the item type for an entity (used for API calls)
 */
const getEntityItemType = (entity: EntityData): ItemType => {
  // For documents, chats, and projects, the type maps directly
  // Email and channel are not shareable through this modal
  return entity.type as ItemType;
};

/**
 * Opens the global share modal for the given entity
 */
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

/**
 * Closes the global share modal
 */
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
  const props = () => globalModalProps();

  const handleSetIsOpen = (isOpen: boolean) => {
    if (!isOpen) {
      closeGlobalShareModal();
    }
    setModalOpen(isOpen);
  };

  return (
    <Show when={props()}>
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
            // Default to OWNER permissions - the ShareModal will fetch actual permissions
            userPermissions={Permissions.OWNER}
            owner={entity().ownerId}
          />
        );
      }}
    </Show>
  );
};
