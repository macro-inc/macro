import { scaleLinear, scalePoint } from 'd3-scale';
import { arc, line, type PieArcDatum, pie } from 'd3-shape';
import { createMemo, createSignal, For, Match, Switch } from 'solid-js';
import { formatQueryValue } from '../core/query';
import type { QueryChartData, QueryChartMode } from '../core/query-chart';

const COLORS = [
  'blue',
  'purple',
  'teal',
  'pink',
  'amber',
  'cyan',
  'green',
  'violet',
];
const color = (index: number) =>
  `var(--color-${COLORS[index % COLORS.length]})`;
const label = (value: string) => value.replaceAll('_', ' ');

/** Presentation only; SQL, permission checks and validation live upstream. */
export function QueryChart(props: {
  data: QueryChartData;
  mode: QueryChartMode;
}) {
  const [element, setElement] = createSignal<HTMLElement>();
  const size = createElementSize(element);
  const width = () => Math.max(180, (size.width || 346) - 26);
  const right = () => width() - 12;
  const tickCount = () => (width() < 280 ? 2 : 4);
  const axisLabel = (category: string) => {
    let text = category;
    if (
      /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(category) &&
      Number.isFinite(Date.parse(category))
    )
      text = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(category));
    const limit = Math.max(
      4,
      Math.min(
        12,
        Math.floor(
          (right() - 36) / Math.min(tickCount(), props.data.labels.length) / 7
        )
      )
    );
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  };
  const values = createMemo(() =>
    props.data.series
      .flatMap((series) => series.values)
      .filter((value): value is number => value !== null)
  );
  const extent = createMemo(() => [
    Math.min(0, ...values()),
    Math.max(0, ...values()) || 1,
  ]);
  const percent = createMemo(() =>
    scaleLinear().domain(extent()).range([0, 100])
  );
  const y = createMemo(() =>
    scaleLinear().domain(extent()).nice(4).range([176, 12])
  );
  const x = createMemo(() => {
    const positions = props.data.positions;
    if (positions) {
      const scale = scaleLinear()
        .domain([Math.min(...positions), Math.max(...positions)])
        .range([36, right()]);
      return (index: number) => scale(positions[index]);
    }
    return scalePoint<number>()
      .domain(props.data.labels.map((_, index) => index))
      .range([36, right()])
      .padding(0.15);
  });
  const title = () =>
    props.data.config.title ||
    `${props.data.series.map((series) => label(series.name)).join(', ')} by ${label(props.data.config.x)}`;
  const slices = createMemo(() =>
    pie<number>().sort(null)(
      props.data.series[0].values.map((value) => value ?? 0)
    )
  );
  const slicePath = arc<PieArcDatum<number>>().innerRadius(0).outerRadius(76);
  const total = () =>
    props.data.series[0].values.reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0
    );
  return (
    <figure
      ref={setElement}
      class="min-w-0 space-y-3 rounded-lg border border-edge-muted bg-panel p-3"
    >
      <figcaption class="text-sm font-medium text-ink">{title()}</figcaption>
      <Switch>
        <Match when={props.mode === 'bar'}>
          <div
            role="img"
            aria-label={`${title()}. Bar chart.`}
            class="max-h-80 space-y-3 overflow-auto pr-1"
          >
            <For each={props.data.labels}>
              {(category, index) => (
                <div class="space-y-1">
                  <div class="truncate text-xs text-ink-muted" title={category}>
                    {category}
                  </div>
                  <For each={props.data.series}>
                    {(series, seriesIndex) => (
                      <div
                        class="flex items-center gap-2"
                        title={`${category} · ${label(series.name)}: ${formatQueryValue(series.values[index()])}`}
                      >
                        <div class="relative h-4 min-w-0 flex-1 rounded-sm bg-hover/50">
                          <div
                            class="absolute inset-y-0 w-px bg-edge-muted"
                            style={{ left: `${percent()(0)}%` }}
                          />
                          <div
                            class="absolute inset-y-0 rounded-sm"
                            style={{
                              left: `${Math.min(percent()(0), percent()(series.values[index()] ?? 0))}%`,
                              width: `${Math.abs(percent()(series.values[index()] ?? 0) - percent()(0))}%`,
                              'background-color': color(seriesIndex()),
                            }}
                          />
                        </div>
                        <span class="w-16 shrink-0 truncate text-right text-xs tabular-nums text-ink">
                          {formatQueryValue(series.values[index()])}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.mode === 'line'}>
          <svg
            viewBox={`0 0 ${width()} 220`}
            class="block w-full overflow-visible"
            role="img"
            aria-label={`${title()}. Line chart.`}
          >
            <For each={y().ticks(4)}>
              {(tick) => (
                <g>
                  <line
                    x1="36"
                    x2={right()}
                    y1={y()(tick)}
                    y2={y()(tick)}
                    class="stroke-edge-muted"
                    stroke-dasharray={tick === 0 ? undefined : '3 4'}
                  />
                  <text
                    x="28"
                    y={y()(tick) + 4}
                    text-anchor="end"
                    font-size="12"
                    class="fill-ink-muted"
                  >
                    {new Intl.NumberFormat(undefined, {
                      notation: 'compact',
                      maximumFractionDigits: 1,
                    }).format(tick)}
                  </text>
                </g>
              )}
            </For>
            <For each={props.data.labels}>
              {(category, index) => (
                <Switch>
                  <Match
                    when={
                      index() === 0 ||
                      index() === props.data.labels.length - 1 ||
                      (tickCount() > 2 &&
                        index() %
                          Math.max(
                            1,
                            Math.ceil(props.data.labels.length / tickCount())
                          ) ===
                          0)
                    }
                  >
                    <text
                      x={x()(index())}
                      y="200"
                      text-anchor={
                        index() === 0
                          ? 'start'
                          : index() === props.data.labels.length - 1
                            ? 'end'
                            : 'middle'
                      }
                      font-size="12"
                      class="fill-ink-muted"
                    >
                      <title>{category}</title>
                      {axisLabel(category)}
                    </text>
                  </Match>
                </Switch>
              )}
            </For>
            <For each={props.data.series}>
              {(series, index) => (
                <g>
                  <path
                    d={
                      line<number | null>()
                        .defined((value) => value !== null)
                        .x((_, point) => x()(point) ?? 48)
                        .y((value) => y()(value ?? 0))(series.values) ?? ''
                    }
                    fill="none"
                    stroke={color(index())}
                    stroke-width="2.5"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                  <For each={series.values}>
                    {(value, point) => (
                      <Switch>
                        <Match when={value !== null}>
                          <circle
                            cx={x()(point())}
                            cy={y()(value ?? 0)}
                            r="3"
                            fill={color(index())}
                          >
                            <title>{`${props.data.labels[point()]} · ${label(series.name)}: ${formatQueryValue(value)}`}</title>
                          </circle>
                        </Match>
                      </Switch>
                    )}
                  </For>
                </g>
              )}
            </For>
          </svg>
        </Match>
        <Match when={props.mode === 'pie'}>
          <div class="flex flex-wrap items-center gap-4">
            <svg
              viewBox="0 0 168 168"
              class="mx-auto size-40 shrink-0"
              role="img"
              aria-label={`${title()}. Pie chart.`}
            >
              <g transform="translate(84 84)">
                <For each={slices()}>
                  {(slice, index) => (
                    <path
                      d={slicePath(slice) ?? ''}
                      fill={color(index())}
                      class="stroke-panel"
                      stroke-width="2"
                    >
                      <title>{`${props.data.labels[index()]}: ${formatQueryValue(slice.value)} (${Math.round((slice.value / total()) * 100)}%)`}</title>
                    </path>
                  )}
                </For>
              </g>
            </svg>
            <ul class="min-w-32 flex-1 space-y-2 text-xs">
              <For each={props.data.labels}>
                {(category, index) => (
                  <li class="flex min-w-0 items-center gap-2">
                    <span
                      class="size-2 shrink-0 rounded-sm"
                      style={{ 'background-color': color(index()) }}
                    />
                    <span
                      class="min-w-0 flex-1 truncate text-ink-muted"
                      title={category}
                    >
                      {category}
                    </span>
                    <span
                      class="shrink-0 tabular-nums text-ink"
                      title={formatQueryValue(
                        props.data.series[0].values[index()]
                      )}
                    >
                      {props.data.series[0].values[index()] === null
                        ? '—'
                        : `${Math.round(((props.data.series[0].values[index()] ?? 0) / total()) * 100)}%`}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Match>
      </Switch>
      <Switch>
        <Match when={props.mode !== 'pie'}>
          <ul class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-muted">
            <For each={props.data.series}>
              {(series, index) => (
                <li class="flex min-w-0 items-center gap-1.5">
                  <span
                    class="size-2 shrink-0 rounded-sm"
                    style={{ 'background-color': color(index()) }}
                  />
                  <span class="truncate">{label(series.name)}</span>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </figure>
  );
}

import { createElementSize } from '@solid-primitives/resize-observer';
