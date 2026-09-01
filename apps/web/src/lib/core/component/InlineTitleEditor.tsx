import { cn } from '@ui/utils/classname';
import { createSignal, onMount } from 'solid-js';

/**
 * Inline-editable entity title, mirroring the markdown-document title UX:
 * the title is edited in place with no pencil affordance — put the caret in
 * it, type, and the rename commits on blur/Enter (Escape discards). Blank or
 * unchanged edits are dropped rather than committed.
 */
export function InlineTitleEditor(props: {
  /** Current display name; shown whenever the user isn't mid-edit. */
  value: string;
  placeholder: string;
  ariaLabel: string;
  onRename: (name: string) => void;
  /** Optional typography and sizing override for compact title contexts. */
  class?: string;
  /** Focus and select the name once mounted, for callers that mount the
   * editor in response to an explicit edit gesture. */
  autofocus?: boolean;
  /** Runs after the editor loses focus, whether the edit committed or was
   * discarded, so those callers can drop back to their static title. */
  onExit?: () => void;
}) {
  // Local draft while the user is typing; null = show the current value.
  const [draft, setDraft] = createSignal<string | null>(null);
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    if (!props.autofocus) return;
    inputRef?.focus();
    inputRef?.select();
  });

  const commit = () => {
    const raw = draft();
    setDraft(null);
    if (raw == null) return;
    const next = raw.trim();
    if (!next || next === props.value) return;
    props.onRename(next);
  };

  return (
    <input
      ref={inputRef}
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
      onBlur={() => {
        commit();
        props.onExit?.();
      }}
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
  );
}
