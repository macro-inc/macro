import { scaleOrdinal } from 'd3-scale';
import { arc, type PieArcDatum, pie } from 'd3-shape';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { CHART_PALETTE } from '../core/chart-palette';
import { formatQueryValue } from '../core/query';
import type { QueryChartData, QueryChartPoint } from '../core/query-chart';
import { CHART_TIP } from '../core/query-chart-plot';

const MAX_DIAMETER = 280;
/** A slice label needs this much arc, in radians, to sit inside the slice. */
const MIN_LABEL_ANGLE = 0.3;

/**
 * A pie in the shape of D3's pie-chart component: `pie()` for the angles,
 * `arc()` for the slices, and a label arc at 0.8 of the radius. It shares
 * the Plot charts' palette, font, and tip.
 */
export function PieChart(props: {
  data: QueryChartData;
  width: number;
  label: string;
}) {
  const diameter = () => Math.min(MAX_DIAMETER, Math.max(140, props.width));
  const radius = () => diameter() / 2;
  const color = createMemo(() =>
    scaleOrdinal<string, string>()
      .domain(props.data.categories)
      .range(CHART_PALETTE)
  );
  const slices = createMemo(() =>
    pie<QueryChartPoint>()
      .sort(null)
      .value((point) => point.value ?? 0)(props.data.points)
  );
  const total = () =>
    props.data.points.reduce((sum, point) => sum + (point.value ?? 0), 0);
  const slicePath = () =>
    arc<PieArcDatum<QueryChartPoint>>()
      .innerRadius(0)
      .outerRadius(radius() - 1);
  const labelArc = () =>
    arc<PieArcDatum<QueryChartPoint>>()
      .innerRadius(radius() * 0.8)
      .outerRadius(radius() * 0.8);
  const share = (point: QueryChartPoint) =>
    `${Math.round(((point.value ?? 0) / total()) * 100)}%`;
  const [hover, setHover] = createSignal<{
    point: QueryChartPoint;
    x: number;
    y: number;
  }>();
  let frame: HTMLDivElement | undefined;
  const track = (point: QueryChartPoint, event: PointerEvent) => {
    const bounds = frame?.getBoundingClientRect();
    if (!bounds) return;
    setHover({
      point,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };
  return (
    <div class="space-y-2">
      <div
        ref={frame}
        role="img"
        aria-label={props.label}
        class="relative mx-auto"
        style={{ width: `${diameter()}px`, height: `${diameter()}px` }}
      >
        <svg
          viewBox={`${-radius()} ${-radius()} ${diameter()} ${diameter()}`}
          width={diameter()}
          height={diameter()}
          class="block overflow-visible text-[11px]"
          onPointerLeave={() => setHover()}
        >
          <For each={slices()}>
            {(slice) => (
              <path
                data-slice
                d={slicePath()(slice) ?? ''}
                fill={color()(slice.data.label)}
                class="stroke-panel"
                stroke-width="1.5"
                opacity={
                  hover() && hover()?.point !== slice.data ? 0.7 : undefined
                }
                onPointerMove={(event) => track(slice.data, event)}
              />
            )}
          </For>
          <g
            text-anchor="middle"
            // Ink on a panel halo, as Plot draws text, reads on every hue in both themes.
            class="pointer-events-none fill-ink stroke-panel [paint-order:stroke]"
            stroke-width="3"
            stroke-linejoin="round"
            stroke-opacity="0.85"
          >
            <For
              each={slices().filter(
                (slice) => slice.endAngle - slice.startAngle >= MIN_LABEL_ANGLE
              )}
            >
              {(slice) => (
                <text
                  transform={`translate(${labelArc().centroid(slice).join(',')})`}
                >
                  <tspan x="0" y="-0.3em" font-weight="600">
                    {slice.data.label.length > 14
                      ? `${slice.data.label.slice(0, 13)}…`
                      : slice.data.label}
                  </tspan>
                  <tspan x="0" y="0.9em" fill-opacity="0.85">
                    {formatQueryValue(slice.data.value)}
                  </tspan>
                </text>
              )}
            </For>
          </g>
        </svg>
        <Show when={hover()}>
          {(current) => (
            <div
              aria-hidden="true"
              class="pointer-events-none absolute z-10 w-max max-w-56 whitespace-pre-line rounded-[2px] border text-ink"
              style={{
                left: `${current().x + 12}px`,
                top: `${current().y + 12}px`,
                background: CHART_TIP.fill,
                'border-color': CHART_TIP.stroke,
                'font-size': `${CHART_TIP.fontSize}px`,
                'line-height': String(CHART_TIP.lineHeight),
                padding: `${CHART_TIP.textPadding}px`,
                filter: CHART_TIP.pathFilter,
              }}
            >
              {`${current().point.tip} (${share(current().point)})`}
            </div>
          )}
        </Show>
      </div>
      <ul class="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
        <For each={props.data.points}>
          {(point) => (
            <li class="flex min-w-0 items-center gap-1.5">
              <span
                class="size-2.5 shrink-0"
                style={{ 'background-color': color()(point.label) }}
              />
              <span class="max-w-40 truncate" title={point.label}>
                {point.label}
              </span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
