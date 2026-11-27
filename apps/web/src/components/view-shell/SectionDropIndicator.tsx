import { Show } from 'solid-js';
import type { SectionDropEdge } from './core/section-order';

export function SectionDropIndicator(props: { edge?: SectionDropEdge }) {
  return (
    <Show when={props.edge}>
      {(edge) => (
        <div
          aria-hidden="true"
          class="pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-accent"
          classList={{
            'top-0': edge() === 'top',
            'bottom-0': edge() === 'bottom',
          }}
        />
      )}
    </Show>
  );
}
