import { type EntityData, InlineEntity } from '@entity';
import { createBulkDeleteDssItemsMutation } from '@macro-entity';
import { Dialog } from '@kobalte/core/dialog';
import { Button } from '@ui/components/Button';
import { For } from 'solid-js';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';

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
    <>
      <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b-1 border-b-edge-muted h-[40px]">
        <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
          <CloseIcon />
        </Dialog.CloseButton>
        <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
          Delete{' '}
          {props.entities.length === 1
            ? 'Item'
            : `${props.entities.length} Items`}
        </Dialog.Title>
      </div>

      <div class="flex flex-col">
        <For each={props.entities}>
          {(entity) => (
            <div class="flex flex-row w-full items-center gap-2 py-1.5 px-2">
              <InlineEntity entity={entity} />
            </div>
          )}
        </For>
      </div>

      <div class="p-3 flex flex-col gap-3">
        <p class="text-sm text-ink-muted">
          {props.entities.length === 1
            ? 'You are about to delete this item. This action cannot be undone.'
            : `You are about to delete ${props.entities.length} items. This action cannot be undone.`}
        </p>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            ref={(el: HTMLButtonElement) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => el.focus())
              );
            }}
            type="button"
            variant="destructive"
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </>
  );
};
