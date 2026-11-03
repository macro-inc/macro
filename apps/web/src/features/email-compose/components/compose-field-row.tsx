import type { JSX } from 'solid-js';

/** Shared inline field layout for full and embedded email composers. */
export function ComposeFieldRow(props: {
  label: string;
  compact?: boolean;
  children: JSX.Element;
  trailing?: JSX.Element;
}) {
  return (
    <div
      class="flex w-full gap-2 border-b border-edge-muted focus-within:border-edge"
      classList={{
        'items-start py-2': props.compact,
        'items-center py-3': !props.compact,
      }}
    >
      <span
        class="shrink-0 text-sm text-ink-placeholder"
        classList={{
          'min-h-7 flex items-center': props.compact,
          'w-14': !props.compact,
        }}
      >
        {props.label}
      </span>
      <div class="min-w-0 flex-1">{props.children}</div>
      {props.trailing}
    </div>
  );
}
