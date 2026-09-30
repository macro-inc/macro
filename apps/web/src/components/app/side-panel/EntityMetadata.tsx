import { getDisplayName, tryMacroId } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';
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
        {(owner) => <div>Owned by {getDisplayName(tryMacroId(owner()))}</div>}
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
