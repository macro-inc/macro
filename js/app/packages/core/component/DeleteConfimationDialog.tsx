import { Dialog } from '@kobalte/core/dialog';
import { TextButton } from './TextButton';

type DeleteConfimationDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onDelete: () => void;
  deleteConfirmationText: () => string;
};

export function DeleteConfimationDialog(props: DeleteConfimationDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed flex inset-0 z-modal bg-modal-overlay items-center justify-content" />
        <Dialog.Content class="fixed left-1/2 top-1/2 z-modal -translate-x-1/2 -translate-y-1/2 bg-dialog rounded-xl p-4 shadow-lg w-80">
          <Dialog.Title class="font-bold mb-2 text-ink">
            Delete Items?
          </Dialog.Title>
          <Dialog.Description
            class="text-sm text-ink mb-4"
            innerHTML={props.deleteConfirmationText()}
          />
          <div class="flex justify-end gap-3 mt-4">
            <Dialog.CloseButton>
              <TextButton text="Cancel" theme="clear" />
            </Dialog.CloseButton>
            <TextButton text="Delete" theme="red" onClick={props.onDelete} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
