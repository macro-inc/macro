/**
 * Selection chrome drawn over the slide in slide coordinates: selected
 * shapes' outlines, resize and rotation handles, drag previews, the marquee,
 * a table cell range, and the text caret and selection while editing.
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
import type { Rect } from '../core/selection';

const points = (pts: Point[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

export function SelectionOverlay(props: {
  width: number;
  height: number;
  /** Points per CSS pixel, so chrome keeps a constant on-screen size. */
  unit: number;
  /** The box handles are drawn on (one shape, or several shapes' bounds). */
  selection?: Box;
  /** Outlines of each selected shape when several are selected. */
  outlines?: Box[];
  showHandles: boolean;
  rotatable: boolean;
  previews?: Box[];
  marquee?: Rect;
  /** Highlighted table cells. */
  cellRange?: Box;
  /** A table border being dragged. */
  guide?: { x1: number; y1: number; x2: number; y2: number };
  /** Smart guides the dragged shapes snapped to. */
  smartGuides?: { xs: number[]; ys: number[] };
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
      <Show when={props.cellRange}>
        {(box) => (
          <rect
            data-testid="pptx-cell-range"
            x={box().x}
            y={box().y}
            width={box().w}
            height={box().h}
            class="fill-accent/20 stroke-accent"
            stroke-width={props.unit * 1.5}
          />
        )}
      </Show>
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
      <For each={props.outlines ?? []}>
        {(box) => (
          <polygon
            data-testid="pptx-selection-outline"
            points={points(corners(box))}
            class="fill-none stroke-accent"
            stroke-width={props.unit}
          />
        )}
      </For>
      <Show when={props.selection}>
        {(box) => (
          <>
            <polygon
              data-testid="pptx-selection"
              points={points(corners(box()))}
              class="fill-none stroke-accent"
              stroke-width={props.unit * (props.editing ? 1 : 1.5)}
              stroke-dasharray={
                props.editing || (props.outlines?.length ?? 0) > 0
                  ? `${4 * props.unit} ${3 * props.unit}`
                  : undefined
              }
            />
            <Show when={props.showHandles && !props.editing}>
              <Show when={props.rotatable}>
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
              </Show>
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
      <For each={props.previews ?? []}>
        {(box) => (
          <polygon
            data-testid="pptx-drag-preview"
            points={points(corners(box))}
            class="fill-accent/10 stroke-accent"
            stroke-width={props.unit}
            stroke-dasharray={`${4 * props.unit} ${3 * props.unit}`}
          />
        )}
      </For>
      <Show when={props.marquee}>
        {(r) => (
          <rect
            data-testid="pptx-marquee"
            x={r().x}
            y={r().y}
            width={r().w}
            height={r().h}
            class="fill-accent/10 stroke-accent"
            stroke-width={props.unit}
            stroke-dasharray={`${3 * props.unit} ${2 * props.unit}`}
          />
        )}
      </Show>
      <For each={props.smartGuides?.xs ?? []}>
        {(x) => (
          <line
            data-testid="pptx-smart-guide"
            x1={x}
            y1={0}
            x2={x}
            y2={props.height}
            class="stroke-[#FF3B8A]"
            stroke-width={props.unit}
            stroke-dasharray={`${4 * props.unit} ${3 * props.unit}`}
          />
        )}
      </For>
      <For each={props.smartGuides?.ys ?? []}>
        {(y) => (
          <line
            data-testid="pptx-smart-guide"
            x1={0}
            y1={y}
            x2={props.width}
            y2={y}
            class="stroke-[#FF3B8A]"
            stroke-width={props.unit}
            stroke-dasharray={`${4 * props.unit} ${3 * props.unit}`}
          />
        )}
      </For>
      <Show when={props.guide}>
        {(g) => (
          <line
            x1={g().x1}
            y1={g().y1}
            x2={g().x2}
            y2={g().y2}
            class="stroke-accent"
            stroke-width={props.unit * 1.5}
            stroke-dasharray={`${4 * props.unit} ${2 * props.unit}`}
          />
        )}
      </Show>
    </svg>
  );
}
