import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { ChartScene, ChartShape } from '../core/chart-scene';

function Shape(props: { shape: ChartShape }) {
  return match(props.shape)
    .with({ type: 'rect' }, (shape) => (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        fill={shape.fill}
      >
        <Show when={shape.tip}>{(tip) => <title>{tip()}</title>}</Show>
      </rect>
    ))
    .with({ type: 'path' }, (shape) => (
      <path
        d={shape.d}
        transform={
          shape.translate
            ? `translate(${shape.translate[0]},${shape.translate[1]})`
            : undefined
        }
        fill={shape.fill ?? 'none'}
        stroke={shape.stroke}
        stroke-width={shape.strokeWidth}
        stroke-linejoin="round"
        stroke-linecap="round"
        opacity={shape.opacity}
      >
        <Show when={shape.tip}>{(tip) => <title>{tip()}</title>}</Show>
      </path>
    ))
    .with({ type: 'circle' }, (shape) => (
      <circle
        cx={shape.x}
        cy={shape.y}
        r={shape.r}
        fill={shape.fill}
        opacity={shape.opacity}
        stroke={shape.stroke}
      >
        <Show when={shape.tip}>{(tip) => <title>{tip()}</title>}</Show>
      </circle>
    ))
    .with({ type: 'line' }, (shape) => (
      <line
        x1={shape.x1}
        y1={shape.y1}
        x2={shape.x2}
        y2={shape.y2}
        stroke={
          shape.role === 'grid'
            ? 'var(--color-edge-muted)'
            : 'var(--color-edge)'
        }
        stroke-width={1}
        shape-rendering="crispEdges"
      />
    ))
    .with({ type: 'text' }, (shape) => (
      <text
        x={shape.x}
        y={shape.y}
        text-anchor={shape.anchor}
        dominant-baseline={shape.baseline}
        font-size={`${shape.size}px`}
        font-weight={shape.role === 'title' ? 600 : undefined}
        fill={
          shape.role === 'title' ? 'var(--color-ink)' : 'var(--color-ink-muted)'
        }
      >
        {shape.text}
      </text>
    ))
    .exhaustive();
}

/** A chart drawn from its laid-out shapes. */
export function SpreadsheetChart(props: {
  scene: ChartScene;
  width: number;
  height: number;
  label: string;
}) {
  return (
    <svg
      width={props.width}
      height={props.height}
      viewBox={`0 0 ${props.width} ${props.height}`}
      role="img"
      aria-label={props.label}
      class="block select-none"
    >
      <For each={props.scene.shapes}>{(shape) => <Shape shape={shape} />}</For>
    </svg>
  );
}
