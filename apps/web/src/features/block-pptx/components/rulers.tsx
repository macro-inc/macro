/**
 * View ▸ Ruler and Gridlines on the editing stage: inch rulers along the
 * slide's top and left edges, measured from its center, with the
 * selection's extent shaded, and dotted gridlines over the slide.
 */

import { For, Show } from 'solid-js';
import { gridLines, rulerTicks } from '../core/rulers';

const SIZE = 20;

function Ruler(props: {
  length: number;
  scale: number;
  vertical: boolean;
  /** The selection's start and end along this edge, in points. */
  span?: [number, number];
}) {
  const ticks = () => rulerTicks(props.length, props.scale);
  const px = () => props.length * props.scale;
  const tickLength = (weight: number) => (weight === 2 ? 8 : weight ? 5 : 3);
  return (
    <svg
      class="pointer-events-none absolute overflow-visible"
      style={
        props.vertical
          ? {
              left: `${-SIZE - 4}px`,
              top: '0',
              width: `${SIZE}px`,
              height: `${px()}px`,
            }
          : {
              top: `${-SIZE - 4}px`,
              left: '0',
              height: `${SIZE}px`,
              width: `${px()}px`,
            }
      }
      data-testid={
        props.vertical ? 'pptx-ruler-vertical' : 'pptx-ruler-horizontal'
      }
      aria-hidden="true"
    >
      <rect
        width={props.vertical ? SIZE : px()}
        height={props.vertical ? px() : SIZE}
        class="fill-panel stroke-edge-muted"
      />
      <Show when={props.span}>
        {(span) => (
          <rect
            data-testid="pptx-ruler-span"
            class="fill-accent/25"
            x={props.vertical ? 0 : span()[0] * props.scale}
            y={props.vertical ? span()[0] * props.scale : 0}
            width={
              props.vertical ? SIZE : (span()[1] - span()[0]) * props.scale
            }
            height={
              props.vertical ? (span()[1] - span()[0]) * props.scale : SIZE
            }
          />
        )}
      </Show>
      <For each={ticks()}>
        {(t) => {
          const at = t.at * props.scale;
          const len = tickLength(t.weight);
          return (
            <>
              <line
                class="stroke-ink-muted"
                stroke-width="1"
                x1={props.vertical ? SIZE - len : at}
                x2={props.vertical ? SIZE : at}
                y1={props.vertical ? at : SIZE - len}
                y2={props.vertical ? at : SIZE}
              />
              <Show when={t.label !== undefined && t.label > 0}>
                <text
                  class="fill-ink-muted font-sans"
                  style={{ 'font-size': '9px', 'text-anchor': 'middle' }}
                  x={props.vertical ? SIZE / 2 - 2 : at}
                  y={props.vertical ? at + 3 : 9}
                >
                  {t.label}
                </text>
              </Show>
            </>
          );
        }}
      </For>
    </svg>
  );
}

/** Rulers just outside the slide's top and left edges. */
export function Rulers(props: {
  width: number;
  height: number;
  scale: number;
  /** The selection's bounds in points. */
  selection?: { x: number; y: number; w: number; h: number };
}) {
  return (
    <>
      <Ruler
        length={props.width}
        scale={props.scale}
        vertical={false}
        span={
          props.selection && [
            props.selection.x,
            props.selection.x + props.selection.w,
          ]
        }
      />
      <Ruler
        length={props.height}
        scale={props.scale}
        vertical
        span={
          props.selection && [
            props.selection.y,
            props.selection.y + props.selection.h,
          ]
        }
      />
    </>
  );
}

/** Dotted gridlines over the slide at the grid spacing. */
export function Gridlines(props: {
  width: number;
  height: number;
  scale: number;
  spacing: number;
}) {
  const xs = () => gridLines(props.width, props.spacing, props.scale);
  const ys = () => gridLines(props.height, props.spacing, props.scale);
  return (
    <svg
      class="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${props.width} ${props.height}`}
      preserveAspectRatio="none"
      data-testid="pptx-gridlines"
      aria-hidden="true"
    >
      <g
        stroke="#7f7f7f"
        stroke-opacity="0.45"
        stroke-width={1 / props.scale}
        stroke-dasharray={`${1 / props.scale} ${3 / props.scale}`}
      >
        <For each={xs()}>
          {(x) => <line x1={x} x2={x} y1={0} y2={props.height} />}
        </For>
        <For each={ys()}>
          {(y) => <line x1={0} x2={props.width} y1={y} y2={y} />}
        </For>
      </g>
    </svg>
  );
}
