import PencilIcon from '@phosphor/pencil-simple.svg';
import { createSignal } from 'solid-js';

/**
 * Inline-editable entity title, mirroring the markdown-document title UX:
 * the title is always editable in place — click to put the caret in it,
 * type, and the rename commits on blur/Enter (Escape discards). Blank or
 * unchanged edits are dropped rather than committed.
 */
export function InlineTitleEditor(props: {
  /** Current display name; shown whenever the user isn't mid-edit. */
  value: string;
  placeholder: string;
  ariaLabel: string;
  onRename: (name: string) => void;
}) {
  // Local draft while the user is typing; null = show the current value.
  const [draft, setDraft] = createSignal<string | null>(null);
  let inputRef: HTMLInputElement | undefined;

  const commit = () => {
    const raw = draft();
    setDraft(null);
    if (raw == null) return;
    const next = raw.trim();
    if (!next || next === props.value) return;
    props.onRename(next);
  };

  return (
    <div class="group flex min-w-0 items-center gap-1.5">
      <input
        ref={inputRef}
        type="text"
        aria-label={props.ariaLabel}
        autocomplete="off"
        data-1p-ignore
        class="field-sizing-content min-w-0 max-w-full truncate bg-transparent text-xl font-semibold outline-none"
        placeholder={props.placeholder}
        value={draft() ?? props.value}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
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
      {/* Hover-only affordance; the input itself is the tab stop, and the
          pencil hides while editing (group-focus-within). */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        class="shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-0"
        onClick={() => {
          inputRef?.focus();
          inputRef?.select();
        }}
      >
        <PencilIcon class="size-4" />
      </button>
    </div>
  );
}
