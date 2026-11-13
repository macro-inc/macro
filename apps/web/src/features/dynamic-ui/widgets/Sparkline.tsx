import { Show } from 'solid-js';

/** The width of the drawing's coordinate space; it stretches to fit. */
const WIDTH = 100;
const HEIGHT = 24;

/**
 * A series as a thin line, oldest value first, stretched to its box. Two
 * values at least draw; fewer draw nothing.
 */
export function Sparkline(props: { values: readonly number[]; label: string }) {
  const points = () => {
    const values = props.values;
    const low = Math.min(...values);
    const high = Math.max(...values);
    const range = high - low || 1;
    const step = WIDTH / Math.max(values.length - 1, 1);
    return values
      .map((value, index) => {
        const x = index * step;
        const y = HEIGHT - ((value - low) / range) * HEIGHT;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  };
  return (
    <Show when={props.values.length > 1}>
      <svg
        role="img"
        aria-label={props.label}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        class="h-6 w-full text-accent"
      >
        <polyline
          points={points()}
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </Show>
  );
}
