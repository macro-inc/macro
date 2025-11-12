import { DeleteConfimationDialog } from '@core/component/DeleteConfimationDialog';
import { DropdownMenuContent } from '@core/component/Menu';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import type { EntityData } from '@macro-entity';
import CommandIcon from '@phosphor-icons/core/regular/command.svg?component-solid';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { createSignal, Show } from 'solid-js';
import { createBulkDeleteDssItemsMutation } from '../../macro-entity/src/queries/dss';
import { createGlobalBulkEditEntityModal } from './bulk-edit-entity/BulkEditEntityModal';
import {
  EntityActionsMenuItems,
  type EntityActionType,
} from './EntityActionsMenuItems';

const { openModal, modalProps, BulkEditEntityModal } =
  createGlobalBulkEditEntityModal();

export const openBulkEditEntityModal = openModal;

interface EntitySelectionToolbarModalProps {
  selectedEntities: EntityData[];
  onClose: VoidFunction;
}

export const EntitySelectionToolbarModal = (
  props: EntitySelectionToolbarModalProps
) => {
  const [openModal, setOpenModal] = createSignal<
    EntityActionType | undefined
  >();

  const bulkDelete = createBulkDeleteDssItemsMutation();

  const deleteConfirmationText = () => {
    const itemName =
      props.selectedEntities.length === 1
        ? props.selectedEntities[0].name
        : undefined;

    return !itemName
      ? `Are you sure you want to delete <b>${props.selectedEntities.length} items?</b>`
      : `Are you sure you want to delete <b>${itemName} and all of its contents</b>?`;
  };

  const handleBulkDelete = () => {
    bulkDelete.mutate(props.selectedEntities);
  };

  return (
    <ScopedPortal scope="split">
      <div class="absolute left-1/2 bottom-2 flex flex-row items-center gap-4 bg-menu border border-edge -translate-x-1/2">
        <div class="flex gap-1 items-center px-2">
          <button
            type="button"
            class="size-6 aspect-square p-1 flex items-center justify-center hover:bg-hover"
            onClick={props.onClose}
          >
            <CloseIcon class="shrink-0" />
          </button>
          <span class="text-ink font-medium w-full whitespace-nowrap">
            {props.selectedEntities.length} selected
          </span>
        </div>

        <Show when={modalProps()}>
          {(props) => <BulkEditEntityModal {...props()} />}
        </Show>
        <DeleteConfimationDialog
          open={openModal() === 'delete'}
          setOpen={(open) => {
            setOpenModal((p) => (!open ? undefined : p));
          }}
          onDelete={handleBulkDelete}
          deleteConfirmationText={deleteConfirmationText}
        />

        <DropdownMenu>
          <DropdownMenu.Trigger
            type="button"
            class="p-2 flex gap-2 items-center h-full w-full hover:bg-hover hover-transition-bg"
          >
            <CommandIcon class="w-4 h-4" />
            <span>Actions</span>
          </DropdownMenu.Trigger>
          <DropdownMenuContent>
            <EntityActionsMenuItems onSelectAction={setOpenModal} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </ScopedPortal>
  );
};
