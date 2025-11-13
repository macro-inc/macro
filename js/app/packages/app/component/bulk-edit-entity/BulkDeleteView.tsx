import { DeleteConfimationDialog } from '@core/component/DeleteConfimationDialog';
import type { EntityData } from '@macro-entity';
import { createSignal, onMount, Show } from 'solid-js';
import { createBulkDeleteDssItemsMutation } from '../../../macro-entity/src/queries/dss';
import { konsoleContextInformation } from '../command/KonsoleItem';
import {
  BulkEditEntityModalActionFooter,
  BulkEditEntityModalTitle,
} from './BulkEditEntityModal';

export const BulkDeleteView = (props: {
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
}) => {
  const bulkDelete = createBulkDeleteDssItemsMutation();
  const [showConfirmation, setShowConfirmation] = createSignal(false);

  // Show confirmation dialog immediately when component mounts
  onMount(() => {
    setShowConfirmation(true);
  });

  const deleteConfirmationText = () => {
    const itemName =
      props.entities.length === 1 ? props.entities[0].name : undefined;

    return !itemName
      ? `Are you sure you want to delete <b>${props.entities.length} items?</b>`
      : `Are you sure you want to delete <b>${itemName} and all of its contents</b>?`;
  };

  const handleDelete = async () => {
    try {
      await bulkDelete.mutateAsync(props.entities);

      // Clear selection after successful deletion
      const context = konsoleContextInformation();
      const clearSelection = context.clearSelection as (() => void) | undefined;
      clearSelection?.();

      setShowConfirmation(false);
      props.onFinish();
    } catch (error) {
      console.error('Failed to delete entities:', error);
      // Keep the confirmation dialog open on error
    }
  };

  const handleCancel = () => {
    setShowConfirmation(false);
    props.onCancel();
  };

  return (
    <div class="w-full">
      <BulkEditEntityModalTitle title="Delete Items" />

      <div class="mb-4">
        <p class="text-ink-muted text-sm">
          {props.entities.length === 1
            ? `You are about to delete "${props.entities[0].name}".`
            : `You are about to delete ${props.entities.length} items.`}
        </p>
        <p class="text-ink-muted text-sm mt-2">This action cannot be undone.</p>
      </div>

      <BulkEditEntityModalActionFooter
        onCancel={handleCancel}
        onConfirm={() => setShowConfirmation(true)}
        confirmText="Delete"
      />

      <Show when={showConfirmation()}>
        <DeleteConfimationDialog
          open={showConfirmation()}
          setOpen={setShowConfirmation}
          onDelete={handleDelete}
          deleteConfirmationText={deleteConfirmationText}
        />
      </Show>
    </div>
  );
};
