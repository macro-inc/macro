import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal, Show } from 'solid-js';

/**
 * Split title that renames in place, the way the rest of the app's titles are
 * renamed: no pencil affordance, double-click to edit (a tap on touch, which
 * has no double-click), commit on blur/Enter and discard on Escape.
 */
export function RenamableSplitTitle(props: {
  label: string;
  ariaLabel: string;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = createSignal(false);

  // The split label's own handlers open the context menu on double-click and
  // the title menu on tap, so an edit gesture stops there.
  const startEditing = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setEditing(true);
  };

  return (
    <Show
      when={editing()}
      fallback={
        <span
          class="inline-block truncate text-sm font-semibold"
          onDblClick={startEditing}
          onClick={(event) => {
            if (isTouchDevice()) startEditing(event);
          }}
        >
          {props.label}
        </span>
      }
    >
      {/* Clicks in the editor aren't clicks on the split title chrome. */}
      <span onClick={(event) => event.stopPropagation()}>
        <InlineTitleEditor
          value={props.label}
          placeholder="Untitled"
          ariaLabel={props.ariaLabel}
          onRename={props.onRename}
          class="text-sm"
          autofocus
          onExit={() => setEditing(false)}
        />
      </span>
    </Show>
  );
}
