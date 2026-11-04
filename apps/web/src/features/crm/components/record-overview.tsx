import type { ParentProps } from 'solid-js';

/** Full-frame record content scrolls beneath the floating split chrome. */
export function RecordOverview(props: ParentProps) {
  return (
    <div class="h-full scroll-pt-12 overflow-y-auto px-6 pb-12 pt-12 scrollbar-hidden touch:scroll-pt-[calc(var(--mobile-content-inset-top,0px)+1.5rem)] touch:pt-[calc(var(--mobile-content-inset-top,0px)+1.5rem)] touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+3rem)]">
      <div class="mx-auto flex max-w-3xl min-w-0 flex-col gap-6">
        {props.children}
      </div>
    </div>
  );
}
