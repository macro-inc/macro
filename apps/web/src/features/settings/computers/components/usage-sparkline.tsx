import { scaleLinear } from 'd3-scale';
import { area, line } from 'd3-shape';
import { createMemo } from 'solid-js';

const WIDTH = 96;
const HEIGHT = 20;

/**
 * A metric over the last day as a tiny line: no axes, a fixed scale from
 * zero to `max` so two computers' lines compare. A `null` value (the computer
 * was off or asleep) breaks the line.
 */
export function UsageSparkline(props: {
  values: readonly (number | null)[];
  max: number;
  label: string;
}) {
  const paths = createMemo(() => {
    const x = scaleLinear()
      .domain([0, Math.max(1, props.values.length - 1)])
      .range([0.5, WIDTH - 0.5]);
    const y = scaleLinear()
      .domain([0, props.max])
      .range([HEIGHT - 1, 1])
      .clamp(true);
    const defined = (value: number | null): value is number => value !== null;
    return {
      line:
        line<number | null>()
          .defined(defined)
          .x((_, index) => x(index))
          .y((value) => y(value ?? 0))(props.values) ?? '',
      area:
        area<number | null>()
          .defined(defined)
          .x((_, index) => x(index))
          .y0(HEIGHT)
          .y1((value) => y(value ?? 0))(props.values) ?? '',
    };
  });
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      class="shrink-0 overflow-visible"
      role="img"
      aria-label={props.label}
    >
      <line
        x1="0"
        x2={WIDTH}
        y1={HEIGHT - 0.5}
        y2={HEIGHT - 0.5}
        class="stroke-edge-muted"
        stroke-width="1"
      />
      <path d={paths().area} class="fill-accent/10" />
      <path
        d={paths().line}
        fill="none"
        class="stroke-accent"
        stroke-width="1.25"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  );
}
