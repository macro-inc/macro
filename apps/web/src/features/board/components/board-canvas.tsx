import { cn } from '@ui';
import type { JSX } from 'solid-js';
import type { Camera } from '../core/camera';

/**
 * The board's surface: a dotted plane that pans and zooms with `camera`.
 * `children` are placed in world units; `overlay` stays fixed on screen.
 */
export function BoardCanvas(props: {
  camera: Camera;
  panning: boolean;
  label: string;
  ref: (element: HTMLElement) => void;
  children: JSX.Element;
  overlay?: JSX.Element;
  class?: string;
}) {
  // Coarser dots when zoomed out keep the grid from turning into noise.
  const gridStep = () => (props.camera.scale < 0.45 ? 96 : 24);
  return (
    <section
      ref={props.ref}
      aria-label={props.label}
      aria-roledescription="board"
      class={cn(
        'relative size-full touch-none overflow-hidden bg-page select-none',
        props.panning ? 'cursor-grabbing' : 'cursor-grab',
        props.class
      )}
      style={{
        'background-image':
          'radial-gradient(circle, color-mix(in oklch, var(--color-edge-muted) 70%, transparent) 1px, transparent 1.25px)',
        'background-size': `${gridStep() * props.camera.scale}px ${gridStep() * props.camera.scale}px`,
        'background-position': `${props.camera.x}px ${props.camera.y}px`,
      }}
    >
      <div
        class="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate(${props.camera.x}px, ${props.camera.y}px) scale(${props.camera.scale})`,
        }}
      >
        {props.children}
      </div>
      {props.overlay}
    </section>
  );
}
