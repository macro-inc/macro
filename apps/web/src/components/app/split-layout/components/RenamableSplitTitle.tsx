import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { Show, type Signal } from 'solid-js';

/**
 * Split title that renames in place on double-click, the gesture the rest of
 * the app's titles use — no pencil affordance, and a single click still
 * belongs to the split chrome (the title menu on touch).
 */
export function RenamableSplitTitle(props: {
  label: string;
  ariaLabel: string;
  onRename: (name: string) => void;
  /** Edit state, owned by the caller so its own chrome (e.g. a Rename menu
   * item) can open the editor too. */
  editing: Signal<boolean>;
}) {
  const [editing, setEditing] = props.editing;

  return (
    <Show
      when={editing()}
      fallback={
        <span
          class="inline-block truncate text-sm font-semibold"
          onDblClick={(event) => {
            // The split label's own double-click opens the context menu.
            event.preventDefault();
            event.stopPropagation();
            setEditing(true);
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
