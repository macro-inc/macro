import type { JSX } from 'solid-js';

export function ChannelSectionEmptyState(props: { children: JSX.Element }) {
  return (
    <div class="mx-2 my-1 rounded-lg border border-dashed border-edge-muted px-3 py-2 text-xs text-ink-extra-muted">
      {props.children}
    </div>
  );
}
