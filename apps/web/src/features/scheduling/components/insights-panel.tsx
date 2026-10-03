import DownloadIcon from '@phosphor/download-simple.svg';
import InfoIcon from '@phosphor/info.svg';
import { Button, Tooltip } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import {
  buildInsightPeriod,
  type InsightDay,
  type InsightMetric,
  insightComparison,
  insightPresetRange,
  insightRangeError,
  insightsCsv,
  previousInsightRange,
} from '../core/insights';
import type { Booking, EventType, SchedulingMember } from '../core/types';
import { Field, SelectInput, TextInput } from './fields';

const SERIES: { key: InsightMetric; label: string; color: string }[] = [
  { key: 'total', label: 'Scheduled', color: 'var(--color-purple)' },
  { key: 'completed', label: 'Completed', color: 'var(--color-success)' },
  { key: 'rescheduled', label: 'Rescheduled', color: 'var(--color-blue)' },
  { key: 'cancelled', label: 'Cancelled', color: 'var(--color-failure)' },
  {
    key: 'hostNoShow',
    label: 'No-show (host)',
    color: 'var(--color-ink-muted)',
  },
  {
    key: 'guestNoShow',
    label: 'No-show (guest)',
    color: 'var(--color-warning)',
  },
];

function formatDate(date: string, long = false): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(long ? { weekday: 'short' } : {}),
  }).format(new Date(`${date}T12:00:00Z`));
}

function InsightSection(props: {
  title: string;
  description?: string;
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section class="min-w-0 overflow-hidden rounded-xl border border-edge-muted bg-panel">
      <header class="flex flex-wrap items-center justify-between gap-3 border-b border-edge-muted bg-surface-1 px-5 py-4">
        <div>
          <h2 class="text-sm font-semibold">{props.title}</h2>
          <Show when={props.description}>
            <p class="mt-1 text-xs text-ink-muted">{props.description}</p>
          </Show>
        </div>
        {props.actions}
      </header>
      {props.children}
    </section>
  );
}

function Metric(props: {
  label: string;
  definition: string;
  value: number;
  previous: number;
  unit?: string;
  lowerIsBetter?: boolean;
}) {
  const improved = () =>
    props.value !== props.previous &&
    (props.lowerIsBetter
      ? props.value < props.previous
      : props.value > props.previous);
  return (
    <div class="flex min-w-0 flex-col gap-2 p-5">
      <div class="flex items-center gap-1.5 text-sm text-ink-muted">
        <span>{props.label}</span>
        <Tooltip label={props.definition}>
          <button
            type="button"
            aria-label={`${props.label}: ${props.definition}`}
            class="shrink-0 rounded focus-visible:outline-2 focus-visible:outline-ink"
          >
            <InfoIcon class="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <p class="text-3xl font-semibold tracking-tight tabular-nums">
        {Number.isInteger(props.value)
          ? props.value.toLocaleString()
          : props.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        <Show when={props.unit}>
          <span class="ml-1 text-base font-normal text-ink-muted">
            {props.unit}
          </span>
        </Show>
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span
          class="rounded px-1.5 py-0.5 font-medium tabular-nums"
          classList={{
            'bg-success-bg text-success-ink': improved(),
            'bg-surface-2 text-ink-muted': !improved(),
          }}
        >
          {insightComparison(props.value, props.previous)}
        </span>
        <span>from last period</span>
      </div>
    </div>
  );
}

function TrendChart(props: { days: InsightDay[] }) {
  const [visible, setVisible] = createSignal<InsightMetric[]>(
    SERIES.map((s) => s.key)
  );
  const [hovered, setHovered] = createSignal<number>();
  const plotted = () => SERIES.filter((s) => visible().includes(s.key));
  const maxValue = () =>
    Math.max(
      4,
      Math.ceil(
        Math.max(
          0,
          ...props.days.flatMap((d) => plotted().map((s) => d[s.key]))
        ) / 4
      ) * 4
    );
  const x = (index: number) =>
    48 + (index / Math.max(1, props.days.length - 1)) * 812;
  const y = (count: number) => 246 - (count / maxValue()) * 210;
  const activeDay = () =>
    hovered() === undefined
      ? undefined
      : props.days[Math.min(hovered()!, props.days.length - 1)];
  const labelIndices = () => [
    ...new Set(
      Array.from({ length: Math.min(7, props.days.length) }, (_, i) =>
        Math.round(
          (i / Math.max(1, Math.min(6, props.days.length - 1))) *
            (props.days.length - 1)
        )
      )
    ),
  ];
  return (
    <InsightSection
      title="Event trends"
      actions={
        <div class="flex flex-wrap gap-1.5" aria-label="Visible chart series">
          <For each={SERIES}>
            {(series) => (
              <button
                type="button"
                aria-pressed={visible().includes(series.key)}
                onClick={() =>
                  setVisible((current) =>
                    current.includes(series.key)
                      ? current.filter((key) => key !== series.key)
                      : [...current, series.key]
                  )
                }
                class="inline-flex items-center gap-1.5 rounded-md border border-edge-muted bg-panel px-2 py-1 text-xs text-ink-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-ink"
                classList={{ 'opacity-40': !visible().includes(series.key) }}
              >
                <span
                  class="size-2 rounded-full"
                  style={{ background: series.color }}
                />
                {series.label}
              </button>
            )}
          </For>
        </div>
      }
    >
      <div class="px-4 pb-4 pt-3 sm:px-6">
        <div
          class="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          tabIndex={0}
          role="group"
          aria-label="Event trends chart. Use left and right arrow keys to explore dates."
          onFocus={() => setHovered((value) => value ?? props.days.length - 1)}
          onBlur={() => setHovered(undefined)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            setHovered((index) =>
              Math.max(
                0,
                Math.min(
                  props.days.length - 1,
                  (index ?? props.days.length - 1) +
                    (event.key === 'ArrowRight' ? 1 : -1)
                )
              )
            );
          }}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const plotX = ((event.clientX - rect.left) / rect.width) * 900;
            setHovered(
              Math.max(
                0,
                Math.min(
                  props.days.length - 1,
                  Math.round(((plotX - 48) / 812) * (props.days.length - 1))
                )
              )
            );
          }}
          onPointerLeave={() => setHovered(undefined)}
        >
          <svg
            viewBox="0 0 900 290"
            class="block w-full"
            role="img"
            aria-label="Daily booking totals and outcomes"
          >
            <For each={[0, 1, 2, 3, 4]}>
              {(step) => (
                <g>
                  <line
                    x1="48"
                    x2="860"
                    y1={y((maxValue() / 4) * step)}
                    y2={y((maxValue() / 4) * step)}
                    stroke="var(--color-edge-muted)"
                    stroke-dasharray="3 3"
                  />
                  <text
                    x="36"
                    y={y((maxValue() / 4) * step) + 4}
                    text-anchor="end"
                    fill="var(--color-ink-muted)"
                    font-size="11"
                  >
                    {(maxValue() / 4) * step}
                  </text>
                </g>
              )}
            </For>
            <For each={plotted()}>
              {(series) => (
                <>
                  <polyline
                    points={props.days
                      .map((day, index) => `${x(index)},${y(day[series.key])}`)
                      .join(' ')}
                    fill="none"
                    stroke={series.color}
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <Show when={props.days.length <= 10}>
                    <For each={props.days}>
                      {(day, index) => (
                        <circle
                          cx={x(index())}
                          cy={y(day[series.key])}
                          r="3"
                          fill="var(--color-panel)"
                          stroke={series.color}
                          stroke-width="1.5"
                        />
                      )}
                    </For>
                  </Show>
                </>
              )}
            </For>
            <For each={labelIndices()}>
              {(index) => (
                <text
                  x={x(index)}
                  y="270"
                  text-anchor="middle"
                  fill="var(--color-ink-muted)"
                  font-size="11"
                >
                  {formatDate(props.days[index].date)}
                </text>
              )}
            </For>
            <Show when={activeDay()}>
              {(day) => (
                <>
                  <line
                    x1={x(Math.min(hovered()!, props.days.length - 1))}
                    x2={x(Math.min(hovered()!, props.days.length - 1))}
                    y1="26"
                    y2="246"
                    stroke="var(--color-edge)"
                  />
                  <For each={plotted()}>
                    {(series) => (
                      <circle
                        cx={x(Math.min(hovered()!, props.days.length - 1))}
                        cy={y(day()[series.key])}
                        r="4"
                        fill={series.color}
                        stroke="var(--color-panel)"
                        stroke-width="2"
                      />
                    )}
                  </For>
                </>
              )}
            </Show>
          </svg>
          <Show when={activeDay()}>
            {(day) => (
              <div
                class="pointer-events-none absolute right-3 top-3 z-10 w-48 rounded-lg border border-edge-muted bg-panel p-3 text-xs shadow-lg"
                role="status"
                aria-live="polite"
              >
                <p class="mb-2 border-b border-edge-muted pb-2 font-semibold">
                  {formatDate(day().date, true)}
                </p>
                <For each={plotted()}>
                  {(series) => (
                    <div class="flex items-center gap-2 py-1">
                      <span
                        class="size-2 rounded-full"
                        style={{ background: series.color }}
                      />
                      <span class="flex-1 text-ink-muted">{series.label}</span>
                      <span class="tabular-nums">{day()[series.key]}</span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>
        <p class="text-center text-xs text-ink-muted">Booking start date</p>
        <details class="mt-4 text-xs text-ink-muted">
          <summary class="w-fit rounded py-1 focus-visible:outline-2 focus-visible:outline-ink">
            View daily data
          </summary>
          <div class="mt-2 max-h-60 overflow-auto rounded-lg border border-edge-muted">
            <table class="w-full text-left tabular-nums">
              <caption class="sr-only">Daily bookings and outcomes</caption>
              <thead class="bg-surface-2">
                <tr>
                  <th class="p-3">Date</th>
                  <For each={SERIES}>
                    {(series) => (
                      <th class="p-3 font-medium">{series.label}</th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={props.days}>
                  {(day) => (
                    <tr class="border-t border-edge-muted">
                      <th class="whitespace-nowrap p-3 font-normal">
                        {formatDate(day.date)}
                      </th>
                      <For each={SERIES}>
                        {(series) => <td class="p-3">{day[series.key]}</td>}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </InsightSection>
  );
}

function HourChart(props: { hours: number[] }) {
  const max = () => Math.max(1, ...props.hours);
  const hourLabel = (hour: number) =>
    `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`;
  return (
    <InsightSection
      title="Popular booking times"
      description="When your meetings start"
    >
      <div class="px-5 pb-5 pt-8">
        <div class="flex h-36 items-end gap-1 border-b border-edge-muted">
          <For each={props.hours}>
            {(count, hour) => (
              <Tooltip
                class="h-full min-w-0 flex-1 items-end"
                label={`${hourLabel(hour())}: ${count} ${count === 1 ? 'booking' : 'bookings'}`}
              >
                <div class="flex h-full min-w-0 flex-1 items-end">
                  <div
                    tabIndex={0}
                    role="img"
                    aria-label={`${hourLabel(hour())}: ${count} bookings`}
                    class="w-full rounded-t-sm bg-ink/70 outline-none hover:bg-ink focus-visible:ring-2 focus-visible:ring-ink/30"
                    style={{
                      height: `${Math.max(count ? 3 : 0, (count / max()) * 100)}%`,
                      'min-height': '2px',
                    }}
                  />
                </div>
              </Tooltip>
            )}
          </For>
        </div>
        <div class="mt-3 flex justify-between text-xs text-ink-muted">
          <span>12am</span>
          <span>6am</span>
          <span>12pm</span>
          <span>6pm</span>
          <span>11pm</span>
        </div>
      </div>
    </InsightSection>
  );
}

function RankedList(props: {
  title: string;
  description: string;
  rows: { id: string; name: string; count: number }[];
  empty: string;
}) {
  const max = () => Math.max(1, ...props.rows.map((row) => row.count));
  return (
    <InsightSection title={props.title} description={props.description}>
      <div class="flex flex-col gap-5 p-5">
        <For
          each={props.rows}
          fallback={
            <p class="py-8 text-center text-sm text-ink-muted">{props.empty}</p>
          }
        >
          {(row) => (
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="truncate" title={row.name}>
                  {row.name}
                </span>
                <span class="text-ink-muted tabular-nums">{row.count}</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  class="h-full rounded-full bg-ink/70"
                  style={{ width: `${(row.count / max()) * 100}%` }}
                />
              </div>
            </div>
          )}
        </For>
      </div>
    </InsightSection>
  );
}

export function InsightsPanel(props: {
  bookings: Booking[];
  events: EventType[];
  members: SchedulingMember[];
  loading: boolean;
  error?: string;
  from: string;
  to: string;
  timeZone: string;
  onRangeChange: (from: string, to: string) => void;
  onRetry: () => void;
  scopeSelector?: JSX.Element;
}) {
  const [eventId, setEventId] = createSignal('all');
  const [hostId, setHostId] = createSignal('all');
  const [customOpen, setCustomOpen] = createSignal(false);
  const [customFrom, setCustomFrom] = createSignal(props.from);
  const [customTo, setCustomTo] = createSignal(props.to);
  const [rangeError, setRangeError] = createSignal('');
  const now = new Date();
  const filtered = createMemo(() =>
    props.bookings.filter(
      (booking) =>
        (eventId() === 'all' || booking.eventTypeId === eventId()) &&
        (hostId() === 'all' || booking.hosts.includes(hostId()))
    )
  );
  const current = createMemo(() =>
    buildInsightPeriod(
      filtered(),
      { from: props.from, to: props.to },
      props.timeZone,
      now
    )
  );
  const previous = createMemo(() =>
    buildInsightPeriod(
      filtered(),
      previousInsightRange({ from: props.from, to: props.to }),
      props.timeZone,
      now
    )
  );
  const eventOptions = createMemo(() => {
    const items = new Map(props.events.map((event) => [event.id, event.title]));
    for (const booking of props.bookings)
      if (!items.has(booking.eventTypeId))
        items.set(booking.eventTypeId, booking.title);
    return [
      { value: 'all', label: 'All event types' },
      ...[...items].map(([value, label]) => ({ value, label })),
    ];
  });
  const hostOptions = createMemo(() => {
    const items = new Map(
      props.members.map((member) => [member.id, member.name || member.email])
    );
    for (const booking of props.bookings)
      for (const id of booking.hosts)
        if (!items.has(id)) items.set(id, 'Former member');
    return [
      { value: 'all', label: 'All hosts' },
      ...[...items].map(([value, label]) => ({ value, label })),
    ];
  });
  const selectedRange = () => {
    if (customOpen()) return 'custom';
    return (
      [7, 30, 90]
        .find((days) => {
          const range = insightPresetRange(days, props.timeZone, now);
          return range.from === props.from && range.to === props.to;
        })
        ?.toString() ?? 'custom'
    );
  };
  const changePreset = (value: string) => {
    setRangeError('');
    if (value === 'custom') {
      setCustomFrom(props.from);
      setCustomTo(props.to);
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    const range = insightPresetRange(Number(value), props.timeZone, now);
    props.onRangeChange(range.from, range.to);
  };
  const download = () => {
    const csv = insightsCsv(
      current().bookings,
      new Map(
        props.members.map((member) => [member.id, member.name || member.email])
      )
    );
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `booking-insights-${props.from}-${props.to}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div class="flex flex-col gap-5" aria-busy={props.loading}>
      <div class="flex flex-wrap items-center gap-2">
        {props.scopeSelector}
        <div class="w-44">
          <SelectInput
            label="Filter event types"
            value={eventId()}
            options={eventOptions()}
            onChange={setEventId}
          />
        </div>
        <div class="w-40">
          <SelectInput
            label="Filter hosts"
            value={hostId()}
            options={hostOptions()}
            onChange={setHostId}
          />
        </div>
        <div class="hidden flex-1 sm:block" />
        <Button
          variant="outline"
          onClick={download}
          disabled={
            props.loading || !!props.error || !current().bookings.length
          }
          class="h-10"
        >
          <DownloadIcon class="size-4" />
          Download
        </Button>
        <div class="w-40">
          <SelectInput
            label="Insights date range"
            value={selectedRange()}
            onChange={changePreset}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
              { value: 'custom', label: 'Custom range' },
            ]}
          />
        </div>
      </div>
      <Show when={customOpen()}>
        <form
          class="flex flex-wrap items-end gap-3 rounded-xl border border-edge-muted bg-surface-2 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const error = insightRangeError({
              from: customFrom(),
              to: customTo(),
            });
            setRangeError(error ?? '');
            if (!error) {
              setCustomOpen(false);
              props.onRangeChange(customFrom(), customTo());
            }
          }}
        >
          <Field label="Start date">
            <TextInput
              required
              type="date"
              value={customFrom()}
              onInput={(event) => setCustomFrom(event.currentTarget.value)}
            />
          </Field>
          <Field label="End date">
            <TextInput
              required
              type="date"
              value={customTo()}
              min={customFrom()}
              onInput={(event) => setCustomTo(event.currentTarget.value)}
            />
          </Field>
          <Button type="submit" variant="strong" class="h-10">
            Apply dates
          </Button>
          <Button
            type="button"
            variant="ghost"
            class="h-10"
            onClick={() => {
              setCustomOpen(false);
              setRangeError('');
            }}
          >
            Cancel
          </Button>
          <Show when={rangeError()}>
            <p role="alert" class="w-full text-sm text-failure">
              {rangeError()}
            </p>
          </Show>
        </form>
      </Show>
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <p>
          {formatDate(props.from)} – {formatDate(props.to)} ·{' '}
          {props.timeZone.replaceAll('_', ' ')}
        </p>
        <Show when={eventId() !== 'all' || hostId() !== 'all'}>
          <button
            type="button"
            class="underline underline-offset-2"
            onClick={() => {
              setEventId('all');
              setHostId('all');
            }}
          >
            Clear filters
          </button>
        </Show>
      </div>
      <Show when={props.error}>
        <div
          role="alert"
          class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-edge-muted p-5"
        >
          <p class="text-sm">{props.error}</p>
          <Button variant="outline" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      </Show>
      <Show when={props.loading}>
        <p role="status" class="text-sm text-ink-muted">
          Loading booking insights…
        </p>
      </Show>
      <Show when={!props.error}>
        <div
          class="flex flex-col gap-5"
          classList={{ 'opacity-50': props.loading }}
        >
          <InsightSection title="Events">
            <div class="grid grid-cols-1 divide-y divide-edge-muted @sm:grid-cols-2 @3xl:grid-cols-4 @3xl:divide-x @3xl:divide-y-0">
              <Metric
                label="Total events"
                definition="Bookings starting in this period, including pending and cancelled bookings. Failed and processing requests are excluded."
                value={current().counts.total}
                previous={previous().counts.total}
              />
              <Metric
                label="Events completed"
                definition="Confirmed bookings that have ended, excluding marked no-shows. This does not imply attendance was recorded."
                value={current().counts.completed}
                previous={previous().counts.completed}
              />
              <Metric
                label="Events rescheduled"
                definition="Bookings starting in this period with at least one recorded reschedule. Each booking is counted once."
                value={current().counts.rescheduled}
                previous={previous().counts.rescheduled}
              />
              <Metric
                label="Events cancelled"
                definition="Cancelled bookings with a scheduled start in this period."
                value={current().counts.cancelled}
                previous={previous().counts.cancelled}
                lowerIsBetter
              />
            </div>
          </InsightSection>
          <InsightSection title="Performance">
            <div class="grid grid-cols-1 divide-y divide-edge-muted @sm:grid-cols-2 @3xl:grid-cols-4 @3xl:divide-x @3xl:divide-y-0">
              <Metric
                label="Hours in meetings"
                definition="Total scheduled duration of completed events. Actual call duration is not tracked."
                value={current().meetingMinutes / 60}
                previous={previous().meetingMinutes / 60}
                unit="hrs"
              />
              <Metric
                label="Average duration"
                definition="Average scheduled duration of confirmed bookings starting in this period, in minutes."
                value={current().averageMinutes}
                previous={previous().averageMinutes}
                unit="min"
              />
              <Metric
                label="No-show (host)"
                definition="Bookings explicitly marked as a host no-show. Unrecorded attendance is not treated as a no-show."
                value={current().counts.hostNoShow}
                previous={previous().counts.hostNoShow}
                lowerIsBetter
              />
              <Metric
                label="No-show (guest)"
                definition="Bookings explicitly marked as a guest no-show. Unrecorded attendance is not treated as a no-show."
                value={current().counts.guestNoShow}
                previous={previous().counts.guestNoShow}
                lowerIsBetter
              />
            </div>
          </InsightSection>
          <Show when={!props.loading && !current().bookings.length}>
            <p class="rounded-lg border border-dashed border-edge-muted px-5 py-4 text-sm text-ink-muted">
              No bookings match this period and these filters. Try another date
              range or clear the filters.
            </p>
          </Show>
          <TrendChart days={current().days} />
          <div class="grid grid-cols-1 items-start gap-5 @3xl:grid-cols-2">
            <RankedList
              title="Popular event types"
              description="Number of bookings by event type"
              rows={current().eventCounts.map((row) => ({
                ...row,
                name:
                  props.events.find((event) => event.id === row.id)?.title ??
                  row.name,
              }))}
              empty="No event types booked in this period."
            />
            <HourChart hours={current().hours} />
          </div>
          <Show when={hostOptions().length > 2}>
            <RankedList
              title="Bookings by host"
              description="Collective bookings count toward each participating host"
              rows={current().hostCounts.map((row) => ({
                ...row,
                name:
                  props.members.find((member) => member.id === row.id)?.name ??
                  'Former member',
              }))}
              empty="No hosts with bookings in this period."
            />
          </Show>
          <p class="text-xs leading-relaxed text-ink-muted">
            Compared with{' '}
            {formatDate(
              previousInsightRange({ from: props.from, to: props.to }).from
            )}{' '}
            –{' '}
            {formatDate(
              previousInsightRange({ from: props.from, to: props.to }).to
            )}
            . All charts use the booking’s current start date in{' '}
            {props.timeZone.replaceAll('_', ' ')}. A booking can be both
            rescheduled and completed or cancelled.
          </p>
        </div>
      </Show>
    </div>
  );
}
