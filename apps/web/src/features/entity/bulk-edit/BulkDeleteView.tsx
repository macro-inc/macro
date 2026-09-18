import { ActionDialogShell, Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { createBulkDeleteDssItemsMutation } from '../queries/dss';
import type { EntityData } from '../types/entity';
import { EntityActionSelection } from './components/EntityActionSelection';

export const BulkDeleteView = (props: {
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
  onPendingChange?: (pending: boolean) => void;
}) => {
  const mutation = createBulkDeleteDssItemsMutation();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const multi = () => props.entities.length > 1;
  const handleDelete = async () => {
    if (pending() || props.entities.length === 0) return;
    setPending(true);
    props.onPendingChange?.(true);
    setError('');
    try {
      await mutation.mutateAsync(props.entities);
    } catch (cause) {
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
            {multi()
              ? `Delete ${props.entities.length} items?`
              : 'Delete item?'}
          </ActionDialogShell.Title>
          <ActionDialogShell.Description>
            {multi()
              ? 'These items will be permanently deleted. This cannot be undone.'
              : 'This item will be permanently deleted. This cannot be undone.'}
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>
        <EntityActionSelection entities={props.entities} disabled={pending()} />
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
          disabled={pending() || props.entities.length === 0}
          onClick={() => void handleDelete()}
        >
          {pending()
            ? 'Deleting…'
            : multi()
              ? `Delete ${props.entities.length} items`
              : 'Delete item'}
        </Button>
      </ActionDialogShell.Footer>
    </>
  );
};
