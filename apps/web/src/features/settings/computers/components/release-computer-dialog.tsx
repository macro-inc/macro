import { DeleteDialog } from '@ui';
import { Show } from 'solid-js';

/** Destroys a computer now; enabled only once its exact name is typed. */
export function ReleaseComputerDialog(props: {
  computerName: string;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onRelease: () => void;
}) {
  return (
    <DeleteDialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={`Release ${props.computerName} now?`}
      deleteLabel="Release now"
      confirmationPhrase={props.computerName}
      pending={props.pending}
      class="w-[min(440px,calc(100vw-16px))]"
      onDelete={props.onRelease}
    >
      <div class="space-y-2">
        <p>
          The computer is destroyed right away and its disk is deleted, with
          everything on it. Agents running on it stop. There is no refund for
          the rest of this billing period.
        </p>
        <p>
          To stop paying without losing it today, cancel at period end instead.
        </p>
        <Show when={props.error}>
          {(error) => (
            <p role="alert" class="text-failure">
              {error()}
            </p>
          )}
        </Show>
      </div>
    </DeleteDialog>
  );
}
