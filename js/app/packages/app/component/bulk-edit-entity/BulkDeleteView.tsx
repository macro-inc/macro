import type { EntityData } from '@entity';
import { createBulkDeleteDssItemsMutation } from '@macro-entity';
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

  const handleDelete = async () => {
    try {
      await bulkDelete.mutateAsync(props.entities);
      props.onFinish();
    } catch (error) {
      console.error('Failed to delete entities:', error);
    }
  };

  const handleCancel = () => {
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
        onConfirm={handleDelete}
        confirmText="Delete"
      />
    </div>
  );
};
