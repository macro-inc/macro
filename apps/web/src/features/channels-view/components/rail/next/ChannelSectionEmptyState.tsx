import type { JSX } from 'solid-js';

export function ChannelSectionEmptyState(props: { children: JSX.Element }) {
  return (
    <div class="px-2 py-2">
      <div class="flex flex-col items-start gap-2 rounded-lg border border-edge-muted bg-surface p-3 text-xs leading-relaxed text-ink-muted">
        {props.children}
      </div>
    </div>
  );
}
