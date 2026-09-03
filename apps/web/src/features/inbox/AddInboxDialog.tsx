import { useAddInboxFlow } from '@core/email-link';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, onCleanup } from 'solid-js';
import {
  closeAddInboxDialog,
  isAddInboxDialogOpen,
} from './addInboxDialogState';

export {
  isAddInboxDialogOpen,
  openAddInboxDialog,
} from './addInboxDialogState';

/**
 * Confirmation step before the add-inbox OAuth redirect. Confirming kicks off
 * `useAddInboxFlow`, which navigates the page to Google's consent screen.
 */
export function AddInboxDialog() {
  const addInbox = useAddInboxFlow();
  const [pending, setPending] = createSignal(false);

  onCleanup(closeAddInboxDialog);

  const handleConfirm = async () => {
    if (pending()) return;
    setPending(true);
    // On web this navigates away; on native iOS the OAuth completes in place
    // and resolves, so the dialog dismisses itself.
    try {
      await addInbox();
    } finally {
      setPending(false);
      closeAddInboxDialog();
    }
  };

  return (
    <Dialog
      open={isAddInboxDialogOpen()}
      onOpenChange={(open) => {
        if (!open) closeAddInboxDialog();
      }}
      position="center"
      class="w-120"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="px-6">
          <Dialog.Title class="text-ink text-sm font-semibold">
            Add inbox
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-6 font-sans flex flex-col gap-3">
          <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
            Connect another Gmail account to Macro?
          </Dialog.Description>
          <div class="pt-3 justify-end items-center gap-3 inline-flex">
            <Button
              variant="outline"
              depth={3}
              disabled={pending()}
              onClick={closeAddInboxDialog}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              depth={3}
              disabled={pending()}
              onClick={handleConfirm}
            >
              Add inbox
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
