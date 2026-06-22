import { Layer } from '@ui';
import type { JSX } from 'solid-js';

export function ComponentCell(props: {
  title?: string;
  description?: string;
  children?: JSX.Element;
}) {
  return (
    <Layer depth={1}>
      <section class="flex min-h-32 min-w-0 flex-col gap-3 rounded-lg border border-edge-muted p-3">
        <ShowHeader title={props.title} description={props.description} />
        <div class="min-w-0 flex-1">{props.children}</div>
      </section>
    </Layer>
  );
}

function ShowHeader(props: { title?: string; description?: string }) {
  if (!props.title && !props.description) return null;

  return (
    <header class="flex shrink-0 flex-col gap-1">
      {props.title && (
        <h2 class="text-xs font-medium text-ink">{props.title}</h2>
      )}
      {props.description && (
        <p class="text-xs text-ink-muted">{props.description}</p>
      )}
    </header>
  );
}
