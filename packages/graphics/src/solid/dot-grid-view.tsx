import { createMemo, createUniqueId, Index } from 'solid-js';
import { dotGridLevels } from '../core/dot-grid';
import type { Camera } from '../core/model';

/** Screen-space SVG patterns keep dots one pixel wide at fractional zoom.
 * The scene transform changes their spacing and origin, never their size.
 */
export function DotGrid(props: { camera: Camera; color: string }) {
  const id = `graphics-grid-${createUniqueId()}`;
  const levels = createMemo(() => dotGridLevels(props.camera.scale));
  return (
    <svg
      aria-hidden="true"
      data-graphics-grid
      shape-rendering="crispEdges"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        'pointer-events': 'none',
        'z-index': 0,
      }}
    >
      <defs>
        <Index each={levels()}>
          {(level, index) => (
            <pattern
              id={`${id}-${index}`}
              patternUnits="userSpaceOnUse"
              x={props.camera.x - 0.5}
              y={props.camera.y - 0.5}
              width={level().spacing}
              height={level().spacing}
            >
              <rect
                width="1"
                height="1"
                fill={props.color}
                opacity={level().opacity}
              />
            </pattern>
          )}
        </Index>
      </defs>
      <Index each={levels()}>
        {(_, index) => (
          <rect width="100%" height="100%" fill={`url(#${id}-${index})`} />
        )}
      </Index>
    </svg>
  );
}
