import { ActionDialogShell, Button, Dialog } from '@ui';
import { Show } from 'solid-js';

export function BookingPageLeaveDialog(props: {
  open: boolean;
  pending: boolean;
  canSave: boolean;
  error: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onKeepEditing()}
      onEscapeKeyDown={(event) => props.pending && event.preventDefault()}
      position="center"
      visibleScrim
      class="w-[min(28rem,calc(100vw-32px))]"
    >
      <ActionDialogShell>
        <ActionDialogShell.Body>
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              Save booking page changes?
            </ActionDialogShell.Title>
            <ActionDialogShell.Description>
              Your booking page has unsaved changes. Save them before leaving,
              or discard them.
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          <Show when={props.error}>
            <p role="alert" class="text-sm text-failure">
              {props.error}
            </p>
          </Show>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer>
          <Button
            type="button"
            variant="ghost"
            disabled={props.pending}
            onClick={props.onKeepEditing}
          >
            Keep editing
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={props.pending}
            onClick={props.onDiscard}
          >
            Discard
          </Button>
          <Button
            type="button"
            variant="cta"
            disabled={props.pending || !props.canSave}
            onClick={props.onSave}
          >
            {props.pending ? 'Saving…' : 'Save'}
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
