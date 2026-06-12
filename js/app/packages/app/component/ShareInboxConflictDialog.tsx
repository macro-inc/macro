import {
  dismissShareInboxConfirmation,
  shareInboxConflict,
} from '@core/email-link/share-conflict';
import { Button, Dialog, Panel } from '@ui';
import { Show } from 'solid-js';

/**
 * Confirmation step before promoting a mailbox another user already connected
 * into a shared inbox.
 */
export function ShareInboxConflictDialog(props: {
  open: boolean;
  emailAddress: string;
  ownerEmail: string;
  onCancel: () => void;
  onShare: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      position="center"
      class="w-120 max-w-[calc(100vw-2rem)]"
    >
      <Panel active depth={2} class="rounded-xl">
        <Panel.Header class="px-6">
          <Dialog.Title class="text-ink text-sm font-semibold">
            Share this inbox?
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-6 font-sans flex flex-col gap-3">
          <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
            <span class="text-ink">{props.emailAddress}</span> is already
            connected by <span class="text-ink">{props.ownerEmail}</span>. Share
            it so you both manage one inbox instead of syncing a duplicate copy.
          </Dialog.Description>
          <div class="pt-3 justify-end items-center gap-3 inline-flex">
            <Button variant="base" depth={3} onClick={() => props.onCancel()}>
              Cancel
            </Button>
            <Button variant="active" depth={3} onClick={() => props.onShare()}>
              Share inbox
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

/**
 * Renders conflicts raised via `requestShareInboxConfirmation` (native
 * add-inbox flow, which completes outside the web callback route). Mounted
 * once at the app root.
 */
export function GlobalShareInboxConflictDialog() {
  return (
    <Show when={shareInboxConflict()}>
      {(conflict) => (
        <ShareInboxConflictDialog
          open
          emailAddress={conflict().emailAddress}
          ownerEmail={conflict().ownerEmail}
          onCancel={dismissShareInboxConfirmation}
          onShare={() => {
            const onShare = conflict().onShare;
            dismissShareInboxConfirmation();
            onShare();
          }}
        />
      )}
    </Show>
  );
}
