import { cn } from '@ui';
import { createSignal } from 'solid-js';
import { isComposing } from './composing';

/** Matches the server's limit, shared with templates. */
const MAX_DESCRIPTION_CHARS = 1000;

/**
 * What the routine is for, edited in place under its title like the title
 * itself: it saves on blur or Enter, Escape discards, and clearing it is fine.
 */
export function RoutineDescription(props: {
  value: string;
  onChange: (description: string) => void;
  class?: string;
}) {
  // Local text while editing; null shows the saved value.
  const [draft, setDraft] = createSignal<string | null>(null);
  const commit = () => {
    const raw = draft();
    setDraft(null);
    if (raw === null) return;
    const next = raw.trim();
    if (next !== props.value) props.onChange(next);
  };
  return (
    <textarea
      aria-label="Routine description"
      placeholder="Add a description…"
      rows={1}
      maxLength={MAX_DESCRIPTION_CHARS}
      value={draft() ?? props.value}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isComposing(event)) return;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      class={cn(
        'field-sizing-content w-full min-w-0 resize-none bg-transparent text-base text-ink-muted outline-none placeholder:text-ink-placeholder',
        props.class
      )}
    />
  );
}
