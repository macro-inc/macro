import {
  createBulkDeleteDssItemsMutation,
  type EntityData,
  InlineEntity,
} from '@entity';
import { Dialog } from '@kobalte/core/dialog';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button, cn } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';
import { BulkDeleteFailure } from '../queries/bulk-delete-result';

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
}) => {
  const bulkDelete = createBulkDeleteDssItemsMutation();
  const [remainingEntities, setRemainingEntities] =
    createSignal<EntityData[]>();
  const [partialMessage, setPartialMessage] = createSignal<string>();
  const entities = () => remainingEntities() ?? props.entities;
  let deleteButton: HTMLButtonElement | undefined;

  const focusDeleteButton = () => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => deleteButton?.focus())
    );
  };

  onMount(focusDeleteButton);

  const handleDelete = async () => {
    // Keep the completion attached to the caller that submitted this attempt,
    // even if another modal replaces this one while the request is in flight.
    const onPartialDelete = props.onPartialDelete;
    setPartialMessage(undefined);
    try {
      await bulkDelete.mutateAsync(entities());
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
    }
  };

  const handleCancel = () => {
    props.onCancel();
  };

  return (
    <>
      <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b border-b-edge-muted h-10">
        <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
          <CloseIcon />
        </Dialog.CloseButton>
        <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
          Delete{' '}
          {entities().length === 1 ? 'Item' : `${entities().length} Items`}
        </Dialog.Title>
      </div>

      <div class="p-2 border-b border-edge-muted">
        <div class="flex items-center gap-2">
          <For each={entities().slice(0, 2)}>
            {(entity) => (
              <div
                class={cn(
                  'bg-hover border border-edge-muted px-2 py-1 truncate text-xs rounded-xs',
                  {
                    'max-w-[50%]': entities().length === 2,
                  }
                )}
              >
                <InlineEntity entity={entity} />
              </div>
            )}
          </For>
          <Show when={entities().length > 2}>
            <div class="text-ink-muted text-xs px-2 py-1">
              +{entities().length - 2} more
            </div>
          </Show>
        </div>
      </div>

      <div class="p-3 flex flex-col gap-3">
        <Show when={partialMessage()}>
          {(message) => (
            <p role="status" class="text-sm text-ink-muted">
              {message()}. Only failed items remain for retry.
            </p>
          )}
        </Show>
        <p class="text-sm text-ink-muted">
          {entities().length === 1
            ? 'You are about to delete this item. This action cannot be undone.'
            : `You are about to delete ${entities().length} items. This action cannot be undone.`}
        </p>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            ref={(el: HTMLButtonElement) => {
              deleteButton = el;
              focusDeleteButton();
            }}
            type="button"
            variant="danger"
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </>
  );
};
