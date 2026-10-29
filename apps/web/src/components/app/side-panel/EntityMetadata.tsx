import { type DateValue, formatDate } from '@core/util/date';
import { OwnerLabel } from '@entity/owner/owner-display';
import { type ParentProps, Show } from 'solid-js';

/** Quiet metadata copy shared by every block information footer. */
export function EntityMetadata(
  props: ParentProps<{
    ownerId?: string | null;
    createdAt?: DateValue | null;
    updatedAt?: DateValue | null;
  }>
) {
  return (
    <div class="flex flex-col gap-1">
      <Show when={props.ownerId}>
        {(owner) => (
          <div class="flex min-w-0 items-center gap-1">
            Owned by <OwnerLabel ownerId={owner()} textOnly suppressClick />
          </div>
        )}
      </Show>
      <Show when={props.createdAt}>
        {(created) => (
          <div>Created {formatDate(created(), { showTime: true })}</div>
        )}
      </Show>
      <Show when={props.updatedAt}>
        {(updated) => (
          <div>Last updated {formatDate(updated(), { showTime: true })}</div>
        )}
      </Show>
      {props.children}
    </div>
  );
}
