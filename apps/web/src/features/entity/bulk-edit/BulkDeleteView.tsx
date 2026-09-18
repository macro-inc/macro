import { ActionDialogShell, Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { BulkDeleteFailure } from '../queries/bulk-delete-result';
import { createBulkDeleteDssItemsMutation } from '../queries/dss';
import type { EntityData } from '../types/entity';
import { EntityActionSelection } from './components/EntityActionSelection';

/** Confirmed progress without closing a partially failed deletion dialog. */
export type PartialDeleteHandler = (
  deleted: EntityData[],
  remaining: EntityData[]
) => void;

export const BulkDeleteView = (props: {
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
  onPartialDelete?: PartialDeleteHandler;
  onPendingChange?: (pending: boolean) => void;
}) => {
  const mutation = createBulkDeleteDssItemsMutation();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [remainingEntities, setRemainingEntities] =
    createSignal<EntityData[]>();
  const [partialMessage, setPartialMessage] = createSignal<string>();
  const entities = () => remainingEntities() ?? props.entities;
  const multi = () => entities().length > 1;
  const handleDelete = async () => {
    if (pending() || entities().length === 0) return;
    // Keep progress attached to the caller that submitted this attempt.
    const onPartialDelete = props.onPartialDelete;
    setPartialMessage(undefined);
    setPending(true);
    props.onPendingChange?.(true);
    setError('');
    try {
      await mutation.mutateAsync(entities());
    } catch (cause) {
      if (
        cause instanceof BulkDeleteFailure &&
        cause.deletedEntities.length > 0
      ) {
        setRemainingEntities(cause.failedEntities);
        setPartialMessage(cause.message);
        try {
          onPartialDelete?.(cause.deletedEntities, cause.failedEntities);
        } catch (cleanupError) {
          // Confirmed deletes must stay excluded from retries even if cleanup fails.
          console.error(
            'Failed to clean up partially deleted entities:',
            cleanupError
          );
        }
        return;
      }
      setError('Some items could not be deleted. Please try again.');
      props.onError?.(cause);
      return;
    } finally {
      setPending(false);
      props.onPendingChange?.(false);
    }
    props.onFinish();
  };
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
        <EntityActionSelection entities={entities()} disabled={pending()} />
        <Show when={partialMessage()}>
          {(message) => (
            <p role="status" class="text-sm text-ink-muted">
              {message()}. Only failed items remain for retry.
            </p>
          )}
        </Show>
        <Show when={error()}>
          <p role="alert" class="text-sm text-failure">
            {error()}
          </p>
        </Show>
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        <Button variant="ghost" disabled={pending()} onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={pending() || entities().length === 0}
          onClick={() => void handleDelete()}
        >
          {pending()
            ? 'Deleting…'
            : multi()
              ? `Delete ${entities().length} items`
              : 'Delete item'}
        </Button>
      </ActionDialogShell.Footer>
    </>
  );
};
