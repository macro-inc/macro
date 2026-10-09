import { onCleanup, onMount, Show } from 'solid-js';
import { InlineTitleEditor } from '../../../lib/core/component/InlineTitleEditor';

/** The split header's database name, edited in place by editors. */
export function DatabaseTitle(props: {
  name: string;
  canEdit: boolean;
  autoFocus?: boolean;
  /** Runs after Enter commits the title. */
  onConfirm?: () => void;
  onEditReady?: (edit: (() => void) | undefined) => void;
  onRename: (name: string) => void;
}) {
  let container: HTMLSpanElement | undefined;
  onMount(() =>
    props.onEditReady?.(() => {
      const input = container?.querySelector('input');
      input?.focus();
      input?.select();
    })
  );
  onCleanup(() => props.onEditReady?.(undefined));
  return (
    <Show
      when={props.canEdit}
      fallback={
        <span class="inline-block truncate text-sm font-semibold">
          {props.name}
        </span>
      }
    >
      <span
        ref={container}
        class="flex min-w-0"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.isComposing && props.onConfirm)
            queueMicrotask(props.onConfirm);
        }}
      >
        <InlineTitleEditor
          value={props.name}
          placeholder="Untitled database"
          ariaLabel="Database name"
          class="text-sm"
          autofocus={props.autoFocus}
          onRename={props.onRename}
        />
      </span>
    </Show>
  );
}
