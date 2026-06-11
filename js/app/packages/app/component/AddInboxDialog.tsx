import { useAddInboxFlow } from '@core/email-link';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, onCleanup } from 'solid-js';

const [isOpen, setIsOpen] = createSignal(false);

/**
 * Requests the add-inbox confirmation dialog. The dialog itself is rendered
 * by the settings Account panel, so callers elsewhere (e.g. the mail inbox
 * selector) open settings first and the dialog appears once it mounts.
 */
export const openAddInboxDialog = () => setIsOpen(true);

/**
 * Confirmation step before the add-inbox OAuth redirect. Confirming kicks off
 * `useAddInboxFlow`, which navigates the page to Google's consent screen.
 */
export function AddInboxDialog() {
  const addInbox = useAddInboxFlow();
  const [pending, setPending] = createSignal(false);

  onCleanup(() => setIsOpen(false));

  const handleConfirm = async () => {
    if (pending()) return;
    setPending(true);
    // On web this navigates away; on native iOS the OAuth completes in place
    // and resolves, so the dialog dismisses itself.
    try {
      await addInbox();
    } finally {
      setPending(false);
      setIsOpen(false);
    }
  };

  return (
    <Dialog
      open={isOpen()}
      onOpenChange={setIsOpen}
      position="center"
      class="w-120"
    >
      <Panel active depth={2} class="rounded-xl">
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
              variant="base"
              depth={3}
              disabled={pending()}
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="active"
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
