/**
 * Selection chrome drawn over the slide in slide coordinates: the selected
 * shape's outline, resize and rotation handles, a drag preview, and the text
 * caret and selection while editing.
 */

import { For, Show } from 'solid-js';
import {
  type Box,
  corners,
  HANDLES,
  type Handle,
  handlePosition,
  type Point,
  rotationHandlePosition,
} from '../core/geometry';

const points = (pts: Point[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

export function SelectionOverlay(props: {
  width: number;
  height: number;
  /** Points per CSS pixel, so chrome keeps a constant on-screen size. */
  unit: number;
  selection?: Box;
  showHandles: boolean;
  preview?: Box;
  caret?: [Point, Point];
  textSelection?: Point[][];
  editing: boolean;
  onHandleDown: (
    kind: 'resize' | 'rotate',
    handle: Handle | undefined,
    event: PointerEvent
  ) => void;
}) {
  const handleSize = () => 8 * props.unit;
  return (
    <svg
      class="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox={`0 0 ${props.width} ${props.height}`}
      aria-hidden="true"
    >
      <For each={props.textSelection ?? []}>
        {(quad) => <polygon points={points(quad)} class="fill-accent/30" />}
      </For>
      <Show when={props.caret}>
        {(caret) => (
          <line
            data-testid="pptx-caret"
            x1={caret()[0].x}
            y1={caret()[0].y}
            x2={caret()[1].x}
            y2={caret()[1].y}
            class="animate-pulse stroke-accent"
            stroke-width={1.5 * props.unit}
          />
        )}
      </Show>
      <Show when={props.selection}>
        {(box) => (
          <>
            <polygon
              data-testid="pptx-selection"
              points={points(corners(box()))}
              class="fill-none stroke-accent"
              stroke-width={props.unit * (props.editing ? 1 : 1.5)}
              stroke-dasharray={
                props.editing
                  ? `${4 * props.unit} ${3 * props.unit}`
                  : undefined
              }
            />
            <Show when={props.showHandles && !props.editing}>
              <line
                x1={handlePosition(box(), 'n').x}
                y1={handlePosition(box(), 'n').y}
                x2={rotationHandlePosition(box(), 20 * props.unit).x}
                y2={rotationHandlePosition(box(), 20 * props.unit).y}
                class="stroke-accent"
                stroke-width={props.unit}
              />
              <circle
                data-testid="pptx-rotate-handle"
                cx={rotationHandlePosition(box(), 20 * props.unit).x}
                cy={rotationHandlePosition(box(), 20 * props.unit).y}
                r={handleSize() / 2 + props.unit}
                class="pointer-events-auto cursor-grab fill-surface stroke-accent"
                stroke-width={props.unit * 1.5}
                onPointerDown={(e) =>
                  props.onHandleDown('rotate', undefined, e)
                }
              />
              <For each={HANDLES}>
                {(handle) => {
                  const p = () => handlePosition(box(), handle);
                  return (
                    <rect
                      data-testid={`pptx-handle-${handle}`}
                      x={p().x - handleSize() / 2}
                      y={p().y - handleSize() / 2}
                      width={handleSize()}
                      height={handleSize()}
                      rx={props.unit * 1.5}
                      class="pointer-events-auto fill-surface stroke-accent"
                      style={{ cursor: `${handle}-resize` }}
                      stroke-width={props.unit * 1.5}
                      onPointerDown={(e) =>
                        props.onHandleDown('resize', handle, e)
                      }
                    />
                  );
                }}
              </For>
            </Show>
          </>
        )}
      </Show>
      <Show when={props.preview}>
        {(box) => (
          <polygon
            data-testid="pptx-drag-preview"
            points={points(corners(box()))}
            class="fill-accent/10 stroke-accent"
            stroke-width={props.unit}
            stroke-dasharray={`${4 * props.unit} ${3 * props.unit}`}
          />
        )}
      </Show>
    </svg>
  );
}
