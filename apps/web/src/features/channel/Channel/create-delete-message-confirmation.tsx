import { DeleteDialog } from '@ui';
import { createSignal, type JSX } from 'solid-js';
import type { DeleteMessageInput } from './create-channel-message-actions';

export type DeleteMessageConfirmation = {
  /** Opens the confirmation dialog for the given delete request. */
  requestDelete: (input: DeleteMessageInput) => void;
  /** Renders the confirmation dialog; mount once per channel surface. */
  ConfirmationDialog: () => JSX.Element;
};

/** Deleting the root of a discussion deletes the discussion under it. */
function isDiscussionRoot(input: DeleteMessageInput | undefined) {
  return !!input && input.parent.type !== 'channel' && !input.threadID;
}

/**
 * Wraps a `deleteMessage` mutation with a confirmation step. Deleting a
 * channel message is destructive, so every entry point (action menu, mobile
 * drawer, hotkeys) routes through `requestDelete`, which opens a dialog and
 * only fires the underlying delete once the user confirms.
 */
export function createDeleteMessageConfirmation(
  deleteMessage: (input: DeleteMessageInput) => void
): DeleteMessageConfirmation {
  const [pending, setPending] = createSignal<DeleteMessageInput | undefined>();

  const requestDelete = (input: DeleteMessageInput) => setPending(input);

  const close = () => setPending(undefined);

  const confirm = () => {
    const input = pending();
    if (input) deleteMessage(input);
    close();
  };

  const ConfirmationDialog = () => (
    <DeleteDialog
      open={!!pending()}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={isDiscussionRoot(pending()) ? 'Delete comment' : 'Delete message'}
      body={
        isDiscussionRoot(pending())
          ? 'This comment and every reply to it will be permanently deleted. This action cannot be undone.'
          : 'This message will be permanently deleted. This action cannot be undone.'
      }
      onDelete={confirm}
    />
  );

  return { requestDelete, ConfirmationDialog };
}
