import { fireAndForget } from '@core/util/fireAndForget';
import { isEditableInput } from '@core/util/isEditableInput';
import { ActionDialogShell, Button } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { BulkDeleteFailure } from '../queries/bulk-delete-result';
import { createBulkDeleteDssItemsMutation } from '../queries/dss';
import type { EntityData } from '../types/entity';
import { EntityActionSelection } from './components/EntityActionSelection';

/** Confirmed progress without closing a partially failed deletion dialog. */
export type PartialDeleteHandler = (
  deleted: EntityData[],
  remaining: EntityData[]
) => void;

/** Move focus to Delete when the confirmation opens, so Enter confirms it. */
export function focusDeleteConfirmation(event: Event) {
  const content = event.currentTarget;
  if (!(content instanceof HTMLElement)) return;
  const confirm = content.querySelector<HTMLElement>('[data-confirm-delete]');
  if (!confirm) return;
  event.preventDefault();
  confirm.focus();
}

export const BulkDeleteView = (props: {
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
  onPartialDelete?: PartialDeleteHandler;
}) => {
  const mutation = createBulkDeleteDssItemsMutation();
  const [remainingEntities, setRemainingEntities] =
    createSignal<EntityData[]>();
  const [partialMessage, setPartialMessage] = createSignal<string>();
  const entities = () => remainingEntities() ?? props.entities;
  const multi = () => entities().length > 1;
  let submitting = false;
  const handleDelete = async () => {
    if (submitting) return;
    submitting = true;
    // Keep the completion attached to the caller that submitted this attempt,
    // even if another modal replaces this one while the request is in flight.
    const onPartialDelete = props.onPartialDelete;
    setPartialMessage(undefined);
    try {
      await mutation.mutateAsync(entities());
      props.onFinish();
    } catch (error) {
      if (
        error instanceof BulkDeleteFailure &&
        error.deletedEntities.length > 0
      ) {
        setRemainingEntities(error.failedEntities);
        setPartialMessage(error.message);
        try {
          onPartialDelete?.(error.deletedEntities, error.failedEntities);
        } catch (cleanupError) {
          // A caller cleanup failure must not turn confirmed deletes into
          // retry targets or suppress the partial-success feedback.
          console.error(
            'Failed to clean up partially deleted entities:',
            cleanupError
          );
        }
        return;
      }
      console.error('Failed to delete entities:', error);
      props.onError?.(error);
    } finally {
      submitting = false;
    }
  };

  // Enter confirms before list hotkeys, which listen on document. Escape still
  // dismisses, and a focused control keeps Space and click. Text entry is left alone.
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || event.isComposing) return;
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (event.target instanceof Element && isEditableInput(event.target))
        return;
      event.preventDefault();
      event.stopPropagation();
      fireAndForget(handleDelete(), 'bulk-delete');
    };
    window.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown, true));
  });

  return (
    <>
      <ActionDialogShell.Body>
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>
            {multi() ? `Delete ${entities().length} items?` : 'Delete item?'}
          </ActionDialogShell.Title>
          <ActionDialogShell.Description>
            {multi()
              ? 'These items will be permanently deleted. This cannot be undone.'
              : 'This item will be permanently deleted. This cannot be undone.'}
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>
        <EntityActionSelection entities={entities()} />
        <Show when={partialMessage()}>
          {(message) => (
            <p role="status" class="text-sm text-ink-muted">
              {message()}. Only failed items remain for retry.
            </p>
          )}
        </Show>
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          data-confirm-delete=""
          onClick={() => fireAndForget(handleDelete(), 'bulk-delete')}
        >
          {multi() ? `Delete ${entities().length} items` : 'Delete item'}
        </Button>
      </ActionDialogShell.Footer>
    </>
  );
};
