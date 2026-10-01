import { createMemo, For, Show } from 'solid-js';
import { type Matrix, transformPoint } from '../core/affine';
import { worldToScreen } from '../core/camera';
import type { Camera, Point, RectangleItem } from '../core/model';
import {
  type RadiusHandle,
  radiusHandlePoint,
  radiusHandles,
  rectangleRadius,
} from '../core/radius';

/** Constant-size controls stay inside the shape even at zero corner radius. */
export function RadiusHandles(props: {
  item: RectangleItem;
  transform: Matrix;
  camera: Camera;
  active?: RadiusHandle;
}) {
  const points = createMemo(() => {
    const { item, transform, camera } = props;
    const xScale = Math.hypot(transform[0], transform[1]) * camera.scale;
    const yScale = Math.hypot(transform[2], transform[3]) * camera.scale;
    const points: Partial<Record<RadiusHandle, Point>> = {};
    if (
      !props.active &&
      Math.min(item.geometry.width * xScale, item.geometry.height * yScale) < 32
    )
      return points;
    for (const handle of radiusHandles) {
      if (props.active && props.active !== handle) continue;
      const point = worldToScreen(
        camera,
        transformPoint(
          transform,
          radiusHandlePoint(item, handle, {
            x: 16 / xScale,
            y: 16 / yScale,
          })
        )
      );
      // Pill/circle radii can put two or four controls at the same point.
      if (
        Object.values(points).some(
          (other) => Math.hypot(other.x - point.x, other.y - point.y) < 16
        )
      )
        continue;
      points[handle] = point;
    }
    return points;
  });
  const radius = () => Number(rectangleRadius(props.item).toFixed(2));
  return (
    <For each={radiusHandles}>
      {(handle) => (
        <Show when={points()[handle]}>
          {(point) => (
            <g
              data-graphics-handle={handle}
              role="img"
              aria-label={`Corner radius ${handle.slice(7)}`}
              style={{
                'pointer-events': 'all',
                cursor: props.active ? 'grabbing' : 'grab',
              }}
            >
              <title>{`Corner radius: ${radius()}. Drag to round all corners.`}</title>
              <circle cx={point().x} cy={point().y} r="10" fill="transparent" />
              <circle
                cx={point().x}
                cy={point().y}
                r="4"
                fill="white"
                stroke="#5687ff"
                stroke-width="1"
              />
              <Show when={props.active === handle}>
                <text
                  x={point().x + 14}
                  y={point().y - 12}
                  fill="#5687ff"
                  stroke="white"
                  stroke-width="3"
                  paint-order="stroke"
                  font-size="12"
                  style={{ 'pointer-events': 'none' }}
                >
                  {radius()}
                </text>
              </Show>
            </g>
          )}
        </Show>
      )}
    </For>
  );
}
