import type { JSX } from 'solid-js';

export function InspectorSection(props: {
  title: string;
  children: JSX.Element;
}) {
  return (
    <section
      class="space-y-2 border-b border-edge-muted px-3 py-3 last:border-b-0"
      aria-label={props.title}
    >
      <h2 class="text-xs font-medium text-ink">{props.title}</h2>
      {props.children}
    </section>
  );
}
