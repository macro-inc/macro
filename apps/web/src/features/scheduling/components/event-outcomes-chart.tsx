import HashIcon from '@phosphor/hash.svg';
import PercentIcon from '@phosphor/percent.svg';
import { Button, ButtonGroup } from '@ui';
import { arc, type PieArcDatum, pie } from 'd3-shape';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type {
  InsightOutcomeKey,
  InsightOutcomeRow,
} from '../core/insight-outcomes';

const COLORS: Record<InsightOutcomeKey, string> = {
  completed: 'var(--color-success)',
  upcoming: 'var(--color-purple)',
  cancelled: 'var(--color-failure)',
  pendingApproval: 'var(--color-blue)',
  hostNoShow: 'var(--color-ink-muted)',
  guestNoShow: 'var(--color-warning)',
};

/** D3 computes exclusive slices; the renderer has no booking or aggregation policy. */
export function EventOutcomesChart(props: { rows: InsightOutcomeRow[] }) {
  const total = () => props.rows.reduce((sum, row) => sum + row.count, 0);
  const [active, setActive] = createSignal<InsightOutcomeKey>();
  const [display, setDisplay] = createSignal<'count' | 'percent'>('count');
  const selected = () => props.rows.find((row) => row.key === active());
  const slices = createMemo(() =>
    pie<InsightOutcomeRow>()
      .sort(null)
      .value((row) => row.count)(props.rows.filter((row) => row.count > 0))
  );
  const path = arc<PieArcDatum<InsightOutcomeRow>>()
    .innerRadius(64)
    .outerRadius(94)
    .cornerRadius(3)
    .padAngle((slice) =>
      Math.min(0.025, (slice.endAngle - slice.startAngle) / 3)
    );
  const percentage = (row: InsightOutcomeRow) =>
    `${total() ? Math.round((row.count / total()) * 100) : 0}%`;
  const label = (row: InsightOutcomeRow) =>
    `${row.label}: ${row.count.toLocaleString()} (${percentage(row)})`;
  return (
    <div class="flex min-w-0 flex-col items-center gap-5 p-5 @xl/insight-main:flex-row">
      <div class="relative size-48 shrink-0">
        <svg
          viewBox="-100 -100 200 200"
          class="size-full"
          role="group"
          aria-label="Event outcomes donut chart"
          onPointerLeave={() => setActive(undefined)}
        >
          <Show
            when={total() > 0}
            fallback={
              <circle
                r="79"
                fill="none"
                stroke="var(--color-edge-muted)"
                stroke-width="30"
              />
            }
          >
            <For each={slices()}>
              {(slice) => (
                <path
                  data-outcome={slice.data.key}
                  d={path(slice) ?? ''}
                  fill={COLORS[slice.data.key]}
                  class="outline-none focus-visible:stroke-ink focus-visible:stroke-2"
                  opacity={active() && active() !== slice.data.key ? 0.4 : 1}
                  tabIndex={0}
                  role="img"
                  aria-label={label(slice.data)}
                  onPointerEnter={() => setActive(slice.data.key)}
                  onFocus={() => setActive(slice.data.key)}
                  onBlur={() => setActive(undefined)}
                >
                  <title>{label(slice.data)}</title>
                </path>
              )}
            </For>
          </Show>
          <text text-anchor="middle" class="pointer-events-none fill-ink">
            <tspan x="0" y="0" class="text-3xl font-semibold tabular-nums">
              {total().toLocaleString()}
            </tspan>
            <tspan x="0" y="22" class="fill-ink-muted text-xs">
              Total events
            </tspan>
          </text>
        </svg>
      </div>
      <div class="min-w-0 w-full flex-1">
        <div class="mb-4 flex justify-end">
          <ButtonGroup>
            <Button
              type="button"
              size="icon-md"
              label="Show counts"
              aria-pressed={display() === 'count'}
              onClick={() => setDisplay('count')}
            >
              <HashIcon class="size-4" />
            </Button>
            <Button
              type="button"
              size="icon-md"
              label="Show percentages"
              aria-pressed={display() === 'percent'}
              onClick={() => setDisplay('percent')}
            >
              <PercentIcon class="size-4" />
            </Button>
          </ButtonGroup>
        </div>
        <ul
          aria-label="Event outcomes"
          class="grid gap-x-5 gap-y-3 @xl/insight-main:grid-cols-2"
        >
          <For each={props.rows}>
            {(row) => (
              <li class="flex min-w-0 items-center gap-2 text-xs">
                <span
                  class="size-2.5 shrink-0 rounded-full"
                  style={{ background: COLORS[row.key] }}
                />
                <span class="flex-1 text-ink-muted">{row.label}</span>
                <span class="min-w-9 shrink-0 text-right font-medium tabular-nums">
                  {display() === 'count'
                    ? row.count.toLocaleString()
                    : percentage(row)}
                </span>
              </li>
            )}
          </For>
        </ul>
        <p role="status" class="mt-4 min-h-4 text-xs text-ink-muted">
          {selected()
            ? label(selected()!)
            : total()
              ? 'Each booking appears in one outcome.'
              : 'No events in this period.'}
        </p>
      </div>
    </div>
  );
}
