import type { JSX } from 'solid-js';

export function AvailabilityFieldRow(props: {
  icon: JSX.Element;
  children: JSX.Element;
  align?: 'start' | 'center';
}) {
  return (
    <div
      class="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3"
      classList={{ 'items-center': props.align === 'center' }}
    >
      <span
        aria-hidden="true"
        class="flex size-5 items-center justify-center text-ink-extra-muted [&_svg]:size-5"
        classList={{ 'mt-0.5': props.align !== 'center' }}
      >
        {props.icon}
      </span>
      <div class="min-w-0">{props.children}</div>
    </div>
  );
}
