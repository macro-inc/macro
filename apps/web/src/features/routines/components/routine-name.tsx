import { cn } from '@ui';
import { createSignal } from 'solid-js';
import { isComposing } from './composing';

/**
 * The routine's name, a field of its draft like the description: always
 * editable, committing on Enter or blur, Escape restoring it, and an empty or
 * unchanged name left as it was.
 */
export function RoutineName(props: {
  value: string;
  onChange: (name: string) => void;
  class?: string;
}) {
  // Local text while editing; null shows the saved value.
  const [draft, setDraft] = createSignal<string | null>(null);
  const commit = () => {
    const raw = draft();
    setDraft(null);
    if (raw === null) return;
    const next = raw.trim();
    if (next && next !== props.value) props.onChange(next);
  };
  return (
    <input
      type="text"
      autocomplete="off"
      data-1p-ignore
      aria-label="Routine name"
      placeholder="Routine name"
      value={draft() ?? props.value}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isComposing(event)) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      class={cn(
        'field-sizing-content min-w-0 max-w-full truncate bg-transparent font-semibold outline-none placeholder:text-ink-placeholder',
        props.class
      )}
    />
  );
}
