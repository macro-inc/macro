import { useAddInboxFlow } from '@core/email-link';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, onCleanup } from 'solid-js';

const [isOpen, setIsOpen] = createSignal(false);

/**
 * Requests the add-inbox confirmation dialog. Rendered at the app root
 * (Layout), gated on this signal, so it opens immediately and independent of
 * the settings surface.
 *
 * Entitlement is enforced by the backend: `POST /link/gmail` answers 402 when
 * the user isn't allowed another inbox, and `useAddInboxFlow` maps that to the
 * multi-inbox paywall — so callers can invoke the add-inbox flow directly
 * without a client-side gate that would have to mirror the backend's rule.
 */
export const openAddInboxDialog = () => setIsOpen(true);

export const isAddInboxDialogOpen = isOpen;

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
              onClick={() => setIsOpen(false)}
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
