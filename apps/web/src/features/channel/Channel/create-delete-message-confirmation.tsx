import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import type { MessageParent } from '@service-storage/messages';
import { Button, Dialog, Surface } from '@ui';
import { createSignal, type JSX } from 'solid-js';
import type { DeleteMessageInput } from './create-channel-message-actions';

export type DeleteThreadInput = {
  parent: MessageParent;
  rootId: string;
};

type PendingDelete =
  | { kind: 'message'; input: DeleteMessageInput }
  | { kind: 'thread'; input: DeleteThreadInput };

const COPY = {
  message: {
    title: 'Delete message',
    description:
      'This message will be permanently deleted. This action cannot be undone.',
  },
  thread: {
    title: 'Delete discussion',
    description:
      'This discussion and all its replies will be permanently deleted. This action cannot be undone.',
  },
} as const;

export type DeleteMessageConfirmation = {
  /** Opens the confirmation dialog for the given delete request. */
  requestDelete: (input: DeleteMessageInput) => void;
  /**
   * Opens the confirmation dialog for deleting a whole discussion. Only
   * available when the surface was built with a `deleteThread` mutation.
   */
  requestDeleteThread: (input: DeleteThreadInput) => void;
  /** Renders the confirmation dialog; mount once per channel surface. */
  ConfirmationDialog: () => JSX.Element;
};

/**
 * Wraps a `deleteMessage` mutation with a confirmation step. Deleting a
 * channel message is destructive, so every entry point (action menu, mobile
 * drawer, hotkeys) routes through `requestDelete`, which opens a dialog and
 * only fires the underlying delete once the user confirms. Surfaces that can
 * also delete a whole discussion pass `deleteThread` and use
 * `requestDeleteThread`, which reuses the same dialog with its own copy.
 */
export function createDeleteMessageConfirmation(
  deleteMessage: (input: DeleteMessageInput) => void,
  deleteThread?: (input: DeleteThreadInput) => void
): DeleteMessageConfirmation {
  const [pending, setPending] = createSignal<PendingDelete | undefined>();

  const requestDelete = (input: DeleteMessageInput) =>
    setPending({ kind: 'message', input });

  const requestDeleteThread = (input: DeleteThreadInput) =>
    setPending({ kind: 'thread', input });

  const close = () => setPending(undefined);

  const copy = () => COPY[pending()?.kind ?? 'message'];

  const confirm = () => {
    const request = pending();
    if (request?.kind === 'message') deleteMessage(request.input);
    if (request?.kind === 'thread') deleteThread?.(request.input);
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
            {copy().title}
          </Dialog.Title>
        </div>

        <div class="p-3 flex flex-col gap-3">
          <Dialog.Description class="text-sm text-ink-muted">
            {copy().description}
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

  return { requestDelete, requestDeleteThread, ConfirmationDialog };
}
