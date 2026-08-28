import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cn } from '@ui/utils/classname';
import { createSignal, Show } from 'solid-js';

/**
 * Inline-editable entity title, mirroring the markdown-document title UX:
 * the title is edited in place with no pencil affordance — put the caret in
 * it, type, and the rename commits on blur/Enter (Escape discards). Blank or
 * unchanged edits are dropped rather than committed.
 *
 * Default is an always-editable input (CRM headers). Pass
 * `doubleClickToEdit` when the title shares a click target with surrounding
 * chrome (split headers): the title stays static until double-click, a tap
 * on touch (no double-click there), or keyboard activation.
 */
export function InlineTitleEditor(props: {
  /** Current display name; shown whenever the user isn't mid-edit. */
  value: string;
  placeholder: string;
  ariaLabel: string;
  onRename: (name: string) => void;
  /** Optional typography and sizing override for compact title contexts. */
  class?: string;
  /**
   * Render static text until an explicit edit gesture. Pointer devices
   * double-click; touch taps; keyboard Enter/Space on the title.
   */
  doubleClickToEdit?: boolean;
}) {
  // Local draft while the user is typing; null = show the current value.
  const [draft, setDraft] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal(!props.doubleClickToEdit);

  const commit = () => {
    const raw = draft();
    setDraft(null);
    if (raw == null) return;
    const next = raw.trim();
    if (!next || next === props.value) return;
    props.onRename(next);
  };

  const exit = () => {
    commit();
    if (props.doubleClickToEdit) setEditing(false);
  };

  const startEditing = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    setEditing(true);
  };

  return (
    // Title clicks aren't clicks on surrounding chrome (split menu / tab).
    <span
      class="min-w-0"
      onClick={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
    >
      <Show
        when={editing()}
        fallback={
          <button
            type="button"
            aria-label={props.ariaLabel}
            class={cn(
              'inline-block min-w-0 max-w-full truncate bg-transparent p-0 text-left text-xl font-semibold',
              props.class
            )}
            onDblClick={startEditing}
            onClick={(event) => {
              // Mouse click is detail 1; keyboard activation is 0. Touch
              // reports 1 as well, so it goes through isTouchDevice.
              if (isTouchDevice() || event.detail === 0) startEditing(event);
            }}
          >
            {props.value}
          </button>
        }
      >
        <input
          ref={(el) => {
            if (!props.doubleClickToEdit) return;
            el.focus();
            el.select();
          }}
          type="text"
          aria-label={props.ariaLabel}
          autocomplete="off"
          data-1p-ignore
          class={cn(
            'field-sizing-content min-w-0 max-w-full truncate bg-transparent text-xl font-semibold outline-none',
            props.class
          )}
          placeholder={props.placeholder}
          value={draft() ?? props.value}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={exit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
        />
      </Show>
    </span>
  );
}
