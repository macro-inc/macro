import {
  IDENTITY,
  type PencilPoint,
  type ShapeItem,
} from '@macro-inc/graphics';
import { defaultRenderers } from '@macro-inc/graphics/solid';
import { createMemo, Show } from 'solid-js';

const Pencil = defaultRenderers.pencil;

export function EraserTrail(props: { points: readonly PencilPoint[] }) {
  const item = createMemo<ShapeItem<'pencil'>>(() => ({
    id: 'eraser-trail',
    type: 'pencil',
    placement: { parentId: 'scene-root', sortKey: 'a0' },
    transform: IDENTITY,
    geometry: { points: props.points, simulatePressure: false },
    appearance: {
      fill: 'transparent',
      stroke: 'var(--color-ink-muted)',
      strokeWidth: 8,
    },
  }));
  return (
    <div
      aria-hidden="true"
      data-eraser-trail
      class="pointer-events-none absolute inset-0 opacity-25"
    >
      <Show when={props.points.length}>
        <Pencil item={item()} scale={1} />
      </Show>
    </div>
  );
}
