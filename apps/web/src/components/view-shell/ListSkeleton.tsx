import { cn } from '@ui';
import { createSignal, onCleanup, onMount, type ParentProps } from 'solid-js';

function Root(props: ParentProps<{ label: string; class?: string }>) {
  const [visible, setVisible] = createSignal(false);
  onMount(() => {
    const timeout = window.setTimeout(() => setVisible(true), 150);
    onCleanup(() => window.clearTimeout(timeout));
  });

  return (
    <div role="status" aria-label={props.label} class={props.class}>
      <span class="sr-only">{props.label}</span>
      <div aria-hidden="true" classList={{ invisible: !visible() }}>
        {props.children}
      </div>
    </div>
  );
}

function Row(props: ParentProps<{ class?: string }>) {
  return (
    <div
      class={cn(
        'flex h-(--sidebar-row-height) min-w-0 items-center gap-(--sidebar-label-gap) px-(--sidebar-item-inset) touch:h-11',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function Bar(props: { class?: string }) {
  return (
    <div
      class={cn('skeleton-shimmer h-2.5 rounded-full bg-skeleton', props.class)}
    />
  );
}

/** Decorative list geometry; the caller owns loading and pagination state. */
export const ListSkeleton = { Root, Row, Bar };
