import type { EntityItem } from '@core/context/quickAccess';
import Pencil from '@phosphor/pencil-simple.svg';
import Trash from '@phosphor/trash-simple.svg';
import { Show } from 'solid-js';

/** Document actions only; built-in skills have no editable document. */
export function SkillActions(props: {
  item: EntityItem;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  return (
    <div class="ml-2 flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label={`Edit ${props.item.data.name}`}
        title="Edit skill"
        class="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink"
        on:click={(event) => {
          event.stopPropagation();
          props.onEdit();
        }}
      >
        <Pencil class="size-4" />
      </button>
      <Show when={props.onDelete}>
        <button
          type="button"
          aria-label={`Delete ${props.item.data.name}`}
          title="Delete skill"
          class="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink"
          on:click={(event) => {
            event.stopPropagation();
            props.onDelete?.();
          }}
        >
          <Trash class="size-4" />
        </button>
      </Show>
    </div>
  );
}
