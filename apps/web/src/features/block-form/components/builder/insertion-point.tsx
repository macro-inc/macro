import type { JSX } from 'solid-js';

/** An insertion affordance over a boundary, without moving the surrounding cards. */
export function InsertionPoint(props: {
  betweenSections?: boolean;
  children: JSX.Element;
}) {
  return (
    <div
      class={`absolute inset-x-0 z-20 flex h-6 items-center justify-center gap-2 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100 has-[[data-expanded]]:opacity-100 ${props.betweenSections ? '-top-8' : '-top-3'}`}
    >
      <span class="h-px flex-1 bg-accent" />
      {props.children}
      <span class="h-px flex-1 bg-accent" />
    </div>
  );
}
