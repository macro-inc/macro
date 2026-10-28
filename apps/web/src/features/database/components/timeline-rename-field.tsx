import { onMount } from 'solid-js';

/**
 * A record's name typed in place over its bar. Enter or leaving the field
 * saves a changed, non-empty name; Escape keeps the old one.
 */
export function TimelineRenameField(props: {
  name: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  let input: HTMLInputElement | undefined;
  let finished = false;
  const finish = (save: boolean) => {
    if (finished) return;
    finished = true;
    const name = input?.value.trim() ?? '';
    if (save && name && name !== props.name) props.onSave(name);
    else props.onCancel();
  };
  // Opened from a menu: the user asked to type here.
  onMount(() => {
    input?.focus();
    input?.select();
  });
  return (
    <input
      ref={input}
      aria-label="Record name"
      value={props.name}
      class="size-full rounded-md border border-accent bg-menu px-2 text-xs text-ink shadow-sm outline-none"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}
