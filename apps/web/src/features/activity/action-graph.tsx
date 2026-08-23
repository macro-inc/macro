import type { ActivityOverview } from '@queries/activity/graphql/overview';
import { cn, Layer, Tooltip } from '@ui';
import { format } from 'date-fns';
import { createMemo, For, type JSX } from 'solid-js';
import { OVERVIEW_TZ, parseOverviewDate } from './activity-dates';
import {
  type ActivityStats,
  formatDayLabel,
  formatMonthName,
  formatStreak,
  summarizeActivity,
} from './activity-stats';
import {
  buildContributionGrid,
  type ContributionDay,
  type ContributionWeek,
} from './contribution-grid';
import { INTENSITY_CLASS } from './intensity';

const WEEKDAY_LABELS = ['', 'M', '', 'W', '', 'F', ''];

function dateLabel(date: string): string {
  return format(parseOverviewDate(date), 'EEE, MMM d, yyyy', {
    in: OVERVIEW_TZ,
  });
}

function actionLabel(day: ContributionDay): string {
  const noun = day.count === 1 ? 'action' : 'actions';
  return `${day.count.toLocaleString()} ${noun} on ${dateLabel(day.date)}`;
}

function monthLetter(label: string): string {
  return label.slice(0, 1);
}

function monthStat(yearMonth: string | null): string {
  return yearMonth ? formatMonthName(yearMonth) : '—';
}

function dayStat(date: string | null): string {
  return date ? formatDayLabel(date) : '—';
}

/**
 * The actions heatmap as a side-panel-style card: a titled header row, the
 * year of day cells, and a compact stats row, divided like `SidePanel.Card`
 * so it reads as list chrome rather than a dashboard tile.
 */
export function ActionGraph(props: { overview: ActivityOverview }) {
  const grid = createMemo(() => buildContributionGrid(props.overview));
  const monthLabels = createMemo(
    () =>
      new Map(
        grid().monthLabels.map(({ label, weekIndex }) => [
          weekIndex,
          monthLetter(label),
        ])
      )
  );
  const stats = createMemo(() => summarizeActivity(props.overview));

  return (
    <Layer depth={2}>
      <section
        class="overflow-hidden rounded-lg border border-edge-muted bg-surface"
        aria-labelledby="activity-actions-heading"
      >
        <div class="divide-y divide-edge-muted text-xs">
          <ActionGraphHeader total={props.overview.total} />
          <ContributionHeatmap
            weeks={grid().weeks}
            monthLabels={monthLabels()}
          />
          <ActionGraphStats stats={stats()} />
        </div>
      </section>
    </Layer>
  );
}

function ActionGraphHeader(props: { total: number }) {
  return (
    <header class="flex min-h-7 items-center gap-2 px-4 py-2">
      <h2
        id="activity-actions-heading"
        class="font-semibold text-ink-muted text-xs"
      >
        Actions{' '}
        <span class="text-ink-extra-muted tabular-nums">
          ({props.total.toLocaleString()})
        </span>
      </h2>
      <IntensityLegend />
    </header>
  );
}

function IntensityLegend() {
  return (
    <div class="ml-auto flex shrink-0 items-center gap-1 text-ink-extra-muted">
      <span>Fewer</span>
      <For each={[0, 1, 2, 3, 4] as const}>
        {(level) => (
          <span class={`size-2.5 rounded-[3px] ${INTENSITY_CLASS[level]}`} />
        )}
      </For>
      <span>More</span>
    </div>
  );
}

function ContributionHeatmap(props: {
  weeks: ContributionWeek[];
  monthLabels: Map<number, string>;
}) {
  return (
    <div class="overflow-x-auto px-4 py-3 scrollbar-hidden">
      <div class="w-max min-w-full">
        <WeekRow class="mb-1 pl-5">
          <For each={props.weeks}>
            {(_, index) => (
              <MonthLetter label={props.monthLabels.get(index())} />
            )}
          </For>
        </WeekRow>
        <div class="flex items-stretch">
          <WeekdayGutter />
          <WeekRow>
            <For each={props.weeks}>
              {(week) => <HeatmapWeek week={week} />}
            </For>
          </WeekRow>
        </div>
      </div>
    </div>
  );
}

function WeekdayGutter() {
  return (
    <div class="mr-1.5 flex w-3.5 shrink-0 flex-col gap-[3px] text-ink-extra-muted text-xs">
      <For each={WEEKDAY_LABELS}>
        {(label) => (
          <span class="flex min-h-0 flex-1 items-center leading-none">
            {label}
          </span>
        )}
      </For>
    </div>
  );
}

function HeatmapWeek(props: { week: ContributionWeek }) {
  return (
    <WeekColumn class="flex flex-col gap-[3px]">
      <For each={props.week}>{(day) => <DaySquare day={day} />}</For>
    </WeekColumn>
  );
}

function MonthLetter(props: { label?: string }) {
  return (
    <WeekColumn class="text-center text-ink-extra-muted text-xs leading-none">
      {props.label}
    </WeekColumn>
  );
}

function DaySquare(props: { day: ContributionDay | null }) {
  const day = props.day;
  if (!day) {
    return <span class="aspect-square w-full shrink-0" />;
  }

  const label = actionLabel(day);
  return (
    <Tooltip
      as="span"
      placement="top"
      class="aspect-square w-full shrink-0"
      label={label}
    >
      <span
        aria-label={label}
        class={`block size-full rounded-[3px] ${INTENSITY_CLASS[day.intensity]}`}
      />
    </Tooltip>
  );
}

/**
 * One week column. Grows to fill the card width, floored at the day-cell
 * size (a very narrow panel scrolls horizontally rather than squashing the
 * cells) and capped so leftover width goes to the row gaps.
 */
function WeekColumn(props: { class?: string; children?: JSX.Element }) {
  return (
    <div class={cn('max-w-3.5 shrink-0 grow basis-2.5', props.class)}>
      {props.children}
    </div>
  );
}

function WeekRow(props: { class?: string; children?: JSX.Element }) {
  return (
    <div class={cn('flex flex-1 justify-between gap-[3px]', props.class)}>
      {props.children}
    </div>
  );
}

function ActionGraphStats(props: { stats: ActivityStats }) {
  return (
    <dl class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
      <Stat
        label="Most active month"
        value={monthStat(props.stats.mostActiveMonth)}
      />
      <Stat
        label="Most active day"
        value={dayStat(props.stats.mostActiveDay)}
      />
      <Stat
        label="Longest streak"
        value={formatStreak(props.stats.longestStreak)}
      />
      <Stat
        label="Current streak"
        value={formatStreak(props.stats.currentStreak)}
      />
    </dl>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div class="flex min-w-0 items-center gap-1.5">
      <dt class="shrink-0 text-ink-extra-muted">{props.label}</dt>
      <dd class="min-w-0 truncate font-medium text-ink tabular-nums">
        {props.value}
      </dd>
    </div>
  );
}
