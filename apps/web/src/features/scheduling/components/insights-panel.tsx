import DownloadIcon from '@phosphor/download-simple.svg';
import InfoIcon from '@phosphor/info.svg';
import { Button, Tooltip } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import {
  type InsightHostOption,
  insightHostOptions,
  insightHostSelection,
} from '../core/insight-host-options';
import { insightOutcomes } from '../core/insight-outcomes';
import {
  buildInsightPeriod,
  type InsightDay,
  type InsightMetric,
  insightComparison,
  insightsCsv,
  previousInsightRange,
} from '../core/insights';
import type { Booking, EventType, SchedulingMember } from '../core/types';
import { EventOutcomesChart } from './event-outcomes-chart';
import { SelectInput } from './fields';
import { hourLabel, hourPlot, trendPlot } from './insight-chart-options';
import { InsightPlot } from './insight-plot';
import { InsightHostAvatar, InsightsHostFilter } from './insights-host-filter';
import { InsightsRangeSelector } from './insights-range-selector';
import { SchedulingFilterSection } from './scheduling-filter-section';
import { SchedulingFilters } from './scheduling-filters';

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
    <section class="min-w-0 overflow-hidden border-t border-edge-muted">
      <header class="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <h2 class="text-sm font-medium">{props.title}</h2>
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
    <div class="flex min-w-0 flex-col gap-2 px-4 py-3">
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
      <p class="text-2xl font-medium tracking-tight tabular-nums">
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
    SERIES.map((series) => series.key)
  );
  const [selectedDay, setSelectedDay] = createSignal<number>();
  const plotted = () =>
    SERIES.filter((series) => visible().includes(series.key));
  const activeDay = () =>
    selectedDay() === undefined
      ? undefined
      : props.days[Math.min(selectedDay()!, props.days.length - 1)];
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
          class="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          tabIndex={0}
          role="group"
          aria-label="Event trends chart. Use left and right arrow keys to explore dates."
          onFocus={() => setSelectedDay(props.days.length - 1)}
          onBlur={() => setSelectedDay(undefined)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            setSelectedDay((index) =>
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
        >
          <InsightPlot
            label="Daily booking totals and outcomes"
            height={280}
            options={(plot, width) =>
              trendPlot(plot, width, props.days, plotted())
            }
          />
          <Show when={activeDay()}>
            {(day) => (
              <div
                role="status"
                aria-live="polite"
                class="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-surface-1 px-3 py-2 text-xs text-ink-muted"
              >
                <span class="font-medium text-ink">
                  {formatDate(day().date, true)}
                </span>
                <For each={plotted()}>
                  {(series) => (
                    <span>
                      {series.label}: {day()[series.key]}
                    </span>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>
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
  return (
    <InsightSection
      title="Popular booking times"
      description="When your meetings start"
    >
      <div class="p-5">
        <InsightPlot
          label="Bookings by start hour"
          height={200}
          options={(plot, width) => hourPlot(plot, width, props.hours)}
        />
        <details class="mt-3 text-xs text-ink-muted">
          <summary class="w-fit rounded py-1 focus-visible:outline-2 focus-visible:outline-ink">
            View hourly data
          </summary>
          <div class="mt-2 max-h-60 overflow-auto">
            <table class="w-full text-left tabular-nums">
              <caption class="sr-only">Bookings by start hour</caption>
              <thead>
                <tr>
                  <th class="py-2">Hour</th>
                  <th class="py-2">Bookings</th>
                </tr>
              </thead>
              <tbody>
                <For each={props.hours}>
                  {(count, hour) => (
                    <tr class="border-t border-edge-muted">
                      <th class="py-2 font-normal">{hourLabel(hour())}</th>
                      <td class="py-2">{count}</td>
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
  renderHostAvatar?: (host: InsightHostOption) => JSX.Element;
}) {
  const [eventId, setEventId] = createSignal('all');
  const [hostId, setHostId] = createSignal('all');
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
  const outcomes = createMemo(() => insightOutcomes(current().bookings, now));
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
  const hostOptions = createMemo(() =>
    insightHostOptions(props.members, props.events, props.bookings)
  );
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
    <div
      class="@container/insights flex w-full min-w-0 flex-col gap-5"
      aria-busy={props.loading}
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        {props.scopeSelector}
        <div class="ml-auto flex min-w-0 items-center gap-2">
          <Button
            variant="outline"
            onClick={download}
            disabled={
              props.loading || !!props.error || !current().bookings.length
            }
          >
            <DownloadIcon class="size-4" />
            Download
          </Button>
          <SchedulingFilters
            title="Insights filters"
            activeCount={
              Number(eventId() !== 'all') + Number(hostId() !== 'all')
            }
            onClear={() => {
              setEventId('all');
              setHostId('all');
            }}
            mobileChildren={
              <>
                <SchedulingFilterSection
                  value="booking-links"
                  label="Booking links"
                  selected={eventId()}
                  options={eventOptions()}
                  onChange={setEventId}
                />
                <SchedulingFilterSection
                  value="hosts"
                  label="Hosts"
                  selected={hostId()}
                  options={
                    hostOptions().some((option) => option.value === hostId())
                      ? hostOptions()
                      : [
                          ...hostOptions(),
                          insightHostSelection(hostOptions(), hostId()),
                        ]
                  }
                  onChange={setHostId}
                  renderIcon={(option) =>
                    props.renderHostAvatar?.(option) ?? (
                      <InsightHostAvatar host={option} />
                    )
                  }
                />
                <InsightsRangeSelector
                  inline
                  from={props.from}
                  to={props.to}
                  timeZone={props.timeZone}
                  now={now}
                  onChange={props.onRangeChange}
                />
              </>
            }
          >
            <SelectInput
              label="Filter event types"
              class="w-full text-sm touch:h-9"
              value={eventId()}
              options={eventOptions()}
              onChange={setEventId}
            />
            <InsightsHostFilter
              value={hostId()}
              options={hostOptions()}
              onChange={setHostId}
              renderAvatar={props.renderHostAvatar}
            />
            <InsightsRangeSelector
              from={props.from}
              to={props.to}
              timeZone={props.timeZone}
              now={now}
              onChange={props.onRangeChange}
            />
          </SchedulingFilters>
        </div>
      </div>
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
          class="grid min-w-0 grid-cols-1 items-start gap-5 @min-[1000px]/insights:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
          classList={{ 'opacity-50': props.loading }}
        >
          <div class="@container/insight-main flex min-w-0 flex-col gap-5">
            <InsightSection title="Events">
              <EventOutcomesChart rows={outcomes()} />
              <div class="grid grid-cols-1 divide-y divide-edge-muted @sm/insight-main:grid-cols-2 @3xl/insight-main:grid-cols-4 @3xl/insight-main:divide-x @3xl/insight-main:divide-y-0">
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
              <div class="grid grid-cols-1 divide-y divide-edge-muted @sm/insight-main:grid-cols-2 @3xl/insight-main:grid-cols-4 @3xl/insight-main:divide-x @3xl/insight-main:divide-y-0">
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
                No bookings match this period and these filters. Try another
                date range or clear the filters.
              </p>
            </Show>
            <TrendChart days={current().days} />
          </div>
          <div class="flex min-w-0 flex-col gap-5">
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
            <Show when={hostOptions().length > 2}>
              <RankedList
                title="Bookings by host"
                description="Collective bookings count toward each participating host"
                rows={current().hostCounts.map((row) => ({
                  ...row,
                  name:
                    props.members.find((member) => member.id === row.id)
                      ?.name ?? 'Former member',
                }))}
                empty="No hosts with bookings in this period."
              />
            </Show>
          </div>
          <p class="col-span-full text-xs leading-relaxed text-ink-muted">
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
