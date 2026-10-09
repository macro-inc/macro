/**
 * The Curves graph: a curve through points (input → output, 0–255) drawn
 * over the identity diagonal. Drag a point to move it, click the graph to
 * add one, drag a middle point out of the graph to remove it. The curve
 * drawn between points is a monotone cubic, close to Photoshop's.
 * Presentational.
 */

import { createSignal, For } from 'solid-js';
import { normalizeCurve } from '../core/adjustments';

const SIZE = 200;

/** The curve's value at `x` (monotone cubic through sorted points). */
function curveValue(points: [number, number][], x: number): number {
  const n = points.length;
  if (n === 0) return x;
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[n - 1][0]) return points[n - 1][1];
  let k = 0;
  while (k < n - 2 && x > points[k + 1][0]) k++;
  const [x0, y0] = points[k];
  const [x1, y1] = points[k + 1];
  const slope = (i: number) => {
    const [ax, ay] = points[Math.max(0, i - 1)];
    const [bx, by] = points[Math.min(n - 1, i + 1)];
    return bx === ax ? 0 : (by - ay) / (bx - ax);
  };
  const h = x1 - x0;
  if (h <= 0) return y0;
  const t = (x - x0) / h;
  const m0 = slope(k) * h;
  const m1 = slope(k + 1) * h;
  const t2 = t * t;
  const t3 = t2 * t;
  const v =
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * m1;
  return Math.min(255, Math.max(0, v));
}

export function CurveEditor(props: {
  points: [number, number][];
  disabled?: boolean;
  testId?: string;
  onChange: (points: [number, number][], done: boolean) => void;
}) {
  const [dragging, setDragging] = createSignal<number>();
  let svg!: SVGSVGElement;

  const toValue = (e: PointerEvent): [number, number] => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 255;
    const y = (1 - (e.clientY - r.top) / r.height) * 255;
    return [x, y];
  };
  const toScreen = (p: [number, number]) => [
    (p[0] / 255) * SIZE,
    (1 - p[1] / 255) * SIZE,
  ];

  const path = () => {
    const pts = props.points;
    const parts: string[] = [];
    for (let x = 0; x <= 255; x += 3) {
      const [sx, sy] = toScreen([x, curveValue(pts, x)]);
      parts.push(
        `${parts.length === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`
      );
    }
    return parts.join(' ');
  };

  const start = (e: PointerEvent, index: number) => {
    if (props.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    svg.setPointerCapture(e.pointerId);
    setDragging(index);
  };

  const move = (e: PointerEvent) => {
    const index = dragging();
    if (index === undefined) return;
    const [x, y] = toValue(e);
    const pts = props.points.map((p) => [...p] as [number, number]);
    const last = pts.length - 1;
    // Ends move up and down; middle points also across, between neighbors.
    const lo = index === 0 ? 0 : pts[index - 1][0] + 1;
    const hi = index === last ? 255 : pts[index + 1][0] - 1;
    pts[index] = [
      index === 0 || index === last
        ? pts[index][0]
        : Math.min(hi, Math.max(lo, x)),
      Math.min(255, Math.max(0, y)),
    ];
    props.onChange(pts, false);
  };

  const end = (e: PointerEvent) => {
    const index = dragging();
    if (index === undefined) return;
    setDragging(undefined);
    const [, y] = toValue(e);
    const pts = props.points.map((p) => [...p] as [number, number]);
    const middle = index > 0 && index < pts.length - 1;
    // Dragged out of the graph: removed.
    if (middle && (y < -20 || y > 275)) pts.splice(index, 1);
    props.onChange(normalizeCurve(pts), true);
  };

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      class="aspect-square w-full touch-none rounded border border-edge-muted bg-inset"
      data-testid={props.testId}
      onPointerDown={(e) => {
        if (props.disabled) return;
        const [x, y] = toValue(e);
        const pts = normalizeCurve([...props.points, [x, y]]);
        const index = pts.findIndex(
          (p) => p[0] === Math.round(Math.min(255, Math.max(0, x)))
        );
        props.onChange(pts, false);
        if (index >= 0) start(e, index);
      }}
      onPointerMove={move}
      onPointerUp={end}
    >
      <For each={[0.25, 0.5, 0.75]}>
        {(f) => (
          <>
            <line
              x1={f * SIZE}
              y1={0}
              x2={f * SIZE}
              y2={SIZE}
              class="stroke-edge-muted"
              stroke-width="0.5"
            />
            <line
              x1={0}
              y1={f * SIZE}
              x2={SIZE}
              y2={f * SIZE}
              class="stroke-edge-muted"
              stroke-width="0.5"
            />
          </>
        )}
      </For>
      <line
        x1={0}
        y1={SIZE}
        x2={SIZE}
        y2={0}
        class="stroke-edge"
        stroke-width="0.5"
        stroke-dasharray="3 3"
      />
      <path d={path()} fill="none" class="stroke-ink" stroke-width="1.5" />
      <For each={props.points}>
        {(p, i) => {
          const at = () => toScreen(p);
          return (
            <rect
              x={at()[0] - 4}
              y={at()[1] - 4}
              width="8"
              height="8"
              class="fill-surface stroke-ink"
              stroke-width="1"
              data-testid="psd-curve-point"
              onPointerDown={(e) => start(e, i())}
            />
          );
        }}
      </For>
    </svg>
  );
}
