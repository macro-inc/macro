import SpinnerIcon from '@phosphor/spinner.svg';
import type { JSX } from 'solid-js';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { cn } from '../utils/classname';
import { Button } from './Button';
import { Dialog, type DialogProps } from './Dialog';
import type { ManagedDialogProps } from './ImperativeDialog';
import { Surface } from './Surface';

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
      position={props.position}
      class={cn('w-[90%] max-w-120', props.class)}
      visibleScrim
    >
      <Surface depth={2} class="rounded-xl text-ink">
        <div class="flex flex-col gap-3 px-5 py-4">
          <div class="flex flex-col gap-1">
            <Dialog.Title class="text-base font-semibold">
              {props.title}
            </Dialog.Title>
            <Dialog.Description
              as="div"
              class="text-sm leading-5 text-ink-muted"
            >
              {props.body ?? props.children}
            </Dialog.Description>
          </div>

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
                <input
                  id={confirmationInputId}
                  type="text"
                  value={confirmation()}
                  placeholder={phrase()}
                  disabled={props.pending}
                  autofocus
                  onInput={(event) =>
                    setConfirmation(event.currentTarget.value)
                  }
                  class="h-9 w-full rounded-lg border border-edge-muted bg-transparent px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-placeholder hover:border-edge focus:border-accent disabled:opacity-70"
                />
              </div>
            )}
          </Show>
        </div>

        <div class="flex items-center justify-end gap-2 px-5 py-3">
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
        </div>
      </Surface>
    </Dialog>
  );
}
