import SpinnerIcon from '@phosphor/spinner.svg';
import type { JSX } from 'solid-js';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { cn } from '../utils/classname';
import { ActionDialogShell } from './ActionDialogShell';
import { Button } from './Button';
import { Dialog, type DialogProps } from './Dialog';
import type { ManagedDialogProps } from './ImperativeDialog';
import { Input } from './Input';

/** Presentation and behavior options for the shared deletion dialog. */
export type DeleteDialogProps = ManagedDialogProps & {
  title: JSX.Element;
  /** Dialog copy. `children` is used when `body` is omitted. */
  body?: JSX.Element;
  children?: JSX.Element;
  deleteLabel?: JSX.Element;
  cancelLabel?: JSX.Element;
  /** Exact phrase the user must enter before deletion is enabled. */
  confirmationPhrase?: string;
  pending?: boolean;
  position?: DialogProps['position'];
  class?: string;
  onDelete: () => void;
};

/** Shared destructive-action dialog with optional typed confirmation. */
export function DeleteDialog(props: DeleteDialogProps) {
  const confirmationInputId = createUniqueId();
  const [confirmation, setConfirmation] = createSignal('');
  const canDelete = () =>
    !props.pending &&
    (props.confirmationPhrase === undefined ||
      confirmation() === props.confirmationPhrase);

  const close = () => {
    if (props.pending) return;
    setConfirmation('');
    props.onOpenChange(false);
  };

  const deleteItem = () => {
    if (canDelete()) props.onDelete();
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      position={props.position ?? 'center'}
      class={cn('w-110', props.class)}
      visibleScrim
    >
      <ActionDialogShell>
        <ActionDialogShell.Body>
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>{props.title}</ActionDialogShell.Title>
            <ActionDialogShell.Description as="div">
              {props.body ?? props.children}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>

          <Show when={props.confirmationPhrase}>
            {(phrase) => (
              <div class="flex flex-col gap-2">
                <label
                  for={confirmationInputId}
                  class="text-sm leading-5 text-ink-muted"
                >
                  Type <span class="font-medium text-ink">{phrase()}</span> to
                  confirm.
                </label>
                <Input
                  id={confirmationInputId}
                  type="text"
                  value={confirmation()}
                  placeholder={phrase()}
                  disabled={props.pending}
                  onInput={(event) =>
                    setConfirmation(event.currentTarget.value)
                  }
                />
              </div>
            )}
          </Show>
        </ActionDialogShell.Body>

        <ActionDialogShell.Footer>
          <Button
            type="button"
            variant="ghost"
            depth={2}
            class="rounded-lg"
            disabled={props.pending}
            onClick={close}
          >
            {props.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            type="button"
            variant="danger"
            depth={2}
            class="rounded-lg"
            disabled={!canDelete()}
            onClick={deleteItem}
          >
            <Show when={props.pending} fallback={props.deleteLabel ?? 'Delete'}>
              <SpinnerIcon class="size-4 animate-spin" />
              <span class="sr-only">{props.deleteLabel ?? 'Delete'}</span>
            </Show>
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
