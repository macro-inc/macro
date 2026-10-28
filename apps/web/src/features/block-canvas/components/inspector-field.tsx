import type { JSX } from 'solid-js';

/** Keeps property labels and controls on the inspector's shared column grid. */
export function InspectorField(props: {
  label: string;
  children: JSX.Element;
}) {
  return (
    <div class="min-w-0 space-y-1">
      <div class="text-[10px] text-ink-muted">{props.label}</div>
      {props.children}
    </div>
  );
}
