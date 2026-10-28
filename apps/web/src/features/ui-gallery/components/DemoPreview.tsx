import { cn, Layer } from '@ui';
import type { JSX } from 'solid-js';

/**
 * The frame every demo renders inside.
 */
export function DemoPreview(props: {
  /** Per-demo surface depth. */
  depth?: 0 | 1 | 2 | 3 | 4;
  fill?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={cn(
        'rounded-md border border-edge-muted overflow-hidden',
        props.class
      )}
    >
      <Layer depth={props.depth ?? 1}>
        <div
          class={cn(
            'bg-surface p-6 min-h-32',
            props.fill
              ? 'block'
              : 'flex flex-wrap items-center justify-center gap-3'
          )}
        >
          {props.children}
        </div>
      </Layer>
    </div>
  );
}
