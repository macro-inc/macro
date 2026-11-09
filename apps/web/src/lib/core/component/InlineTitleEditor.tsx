import { inputOutlineFocusClasses } from '@ui/components/Input';
import { cn } from '@ui/utils/classname';
import { createSignal, onMount } from 'solid-js';

type InlineTitleEditorProps = {
  value: string;
  placeholder: string;
  ariaLabel: string;
  /** Optional typography and sizing override for compact title contexts. */
  class?: string;
  disabled?: boolean;
  /** Focus and select after an explicit edit gesture mounts the editor. */
  autofocus?: boolean;
  /** Runs after the editor loses focus, whether committed or discarded. */
  onExit?: () => void;
} & (
  | { onRename: (name: string) => void; onValueChange?: never }
  | { onValueChange: (name: string) => void; onRename?: never }
);

/**
 * Borderless inline name editor. Entity renames commit nonblank edits on
 * blur/Enter. Controlled drafts update on every keystroke, including clearing;
 * their owner validates when saving. Escape restores the value from focus.
 */
export function InlineTitleEditor(props: InlineTitleEditorProps) {
  // Local draft while the user is typing; null = show the current value.
  const [draft, setDraft] = createSignal<string | null>(null);
  let inputRef: HTMLInputElement | undefined;
  let valueOnFocus = '';

  onMount(() => {
    if (!props.autofocus) return;
    inputRef?.focus();
    inputRef?.select();
  });

  const commit = () => {
    if (props.onValueChange) return;
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
      disabled={props.disabled}
      autocomplete="off"
      data-1p-ignore
      class={cn(
        'field-sizing-content min-w-0 max-w-full truncate bg-transparent text-xl font-semibold outline-none not-touch:hover:overlay-hover',
        inputOutlineFocusClasses,
        props.class
      )}
      placeholder={props.placeholder}
      value={props.onValueChange ? props.value : (draft() ?? props.value)}
      onFocus={() => {
        valueOnFocus = props.value;
      }}
      onInput={(event) => {
        const value = event.currentTarget.value;
        if (props.onValueChange) props.onValueChange(value);
        else setDraft(value);
      }}
      onBlur={() => {
        commit();
        props.onExit?.();
      }}
      onKeyDown={(e) => {
        if (e.isComposing) return;
        if (e.key === 'Enter') {
          if (props.onValueChange && (e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          props.onValueChange?.(valueOnFocus);
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
