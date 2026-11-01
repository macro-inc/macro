import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { InlineTitleEditor } from '../../../lib/core/component/InlineTitleEditor';

/** The split header's database name, edited in place by editors. */
export function DatabaseTitle(props: {
  name: string;
  canEdit: boolean;
  onEditReady?: (edit: (() => void) | undefined) => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = createSignal(false);
  const startEditing = () => {
    if (props.canEdit) setEditing(true);
  };
  onMount(() => props.onEditReady?.(startEditing));
  onCleanup(() => props.onEditReady?.(undefined));
  return (
    <Show
      when={props.canEdit && editing()}
      fallback={
        <span
          class="inline-block truncate text-sm font-semibold"
          onDblClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            startEditing();
          }}
        >
          {props.name}
        </span>
      }
    >
      <span
        class="flex min-w-0"
        onClick={(event) => event.stopPropagation()}
        onDblClick={(event) => event.stopPropagation()}
      >
        <InlineTitleEditor
          value={props.name}
          placeholder="Untitled database"
          ariaLabel="Database name"
          class="text-sm"
          autofocus
          onExit={() => setEditing(false)}
          onRename={props.onRename}
        />
      </span>
    </Show>
  );
}
