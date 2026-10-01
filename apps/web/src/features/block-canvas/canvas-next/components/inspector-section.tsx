import type { JSX } from 'solid-js';

export function InspectorSection(props: {
  title: string;
  children: JSX.Element;
}) {
  return (
    <section
      class="space-y-3 border-b border-edge px-4 py-4 last:border-b-0"
      aria-label={props.title}
    >
      <h2 class="text-xs font-medium text-ink-muted">{props.title}</h2>
      {props.children}
    </section>
  );
}
