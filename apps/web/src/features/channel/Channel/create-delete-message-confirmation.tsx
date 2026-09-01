import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button, Dialog, Surface } from '@ui';
import { createSignal, type JSX } from 'solid-js';
import type { DeleteMessageInput } from './create-channel-message-actions';

export type RequestDeleteOptions = {
  /** When true, delete immediately instead of opening the confirmation dialog. */
  skipConfirmation?: boolean;
};

export type DeleteMessageConfirmation = {
  /** Opens the confirmation dialog, or deletes immediately when skipping. */
  requestDelete: (
    input: DeleteMessageInput,
    options?: RequestDeleteOptions
  ) => void;
  /** Renders the confirmation dialog; mount once per channel surface. */
  ConfirmationDialog: () => JSX.Element;
};

/**
 * Wraps a `deleteMessage` mutation with a confirmation step. Deleting a
 * channel message is destructive, so every entry point (action menu, mobile
 * drawer, hotkeys) routes through `requestDelete`. Shift-clicking Delete
 * sets `skipConfirmation` and fires the underlying delete immediately.
 */
export function createDeleteMessageConfirmation(
  deleteMessage: (input: DeleteMessageInput) => void
): DeleteMessageConfirmation {
  const [pending, setPending] = createSignal<DeleteMessageInput | undefined>();

  const requestDelete = (
    input: DeleteMessageInput,
    options?: RequestDeleteOptions
  ) => {
    if (options?.skipConfirmation) {
      deleteMessage(input);
      return;
    }
    setPending(input);
  };

  const close = () => setPending(undefined);

  const confirm = () => {
    const input = pending();
    if (input) deleteMessage(input);
    close();
  };

  const ConfirmationDialog = () => (
    <Dialog
      open={!!pending()}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      position="center"
      class="w-[90%] max-w-120"
    >
      <Surface depth={2} class="rounded-xl">
        <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b border-b-edge-muted h-10">
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <CloseIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
            Delete message
          </Dialog.Title>
        </div>

        <div class="p-3 flex flex-col gap-3">
          <Dialog.Description class="text-sm text-ink-muted">
            This message will be permanently deleted. This action cannot be
            undone.
          </Dialog.Description>

          <div class="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              ref={(el: HTMLButtonElement) => {
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => el.focus())
                );
              }}
              type="button"
              variant="danger"
              onClick={confirm}
            >
              Delete
            </Button>
          </div>
        </div>
      </Surface>
    </Dialog>
  );

  return { requestDelete, ConfirmationDialog };
}
