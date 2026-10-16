import type { JSX, ParentProps } from 'solid-js';

/** Pill chrome shared by the session header chips. */
export function ChipShell(props: ParentProps): JSX.Element {
  return (
    <span class="inline-flex h-7 max-w-44 min-w-0 items-center gap-1 rounded-full border border-edge-muted bg-surface px-2 text-xs leading-none text-ink-muted hover:bg-hover hover:text-ink">
      {props.children}
    </span>
  );
}
