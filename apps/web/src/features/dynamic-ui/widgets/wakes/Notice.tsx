import type { JSX } from 'solid-js';

/** A pane's one-line state: no access, nothing yet, not available. */
export function Notice(props: { children: JSX.Element }) {
  return (
    <div class="border-edge-muted text-ink-muted rounded border border-dashed px-3 py-2 text-xs">
      {props.children}
    </div>
  );
}
