import { createElementSize } from '@solid-primitives/resize-observer';
import { cn, Layer, Tooltip } from '@ui';
import { format } from 'date-fns';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import { OVERVIEW_TZ, parseOverviewDate } from '../core/activity-dates';
import {
  type ActivityStats,
  formatDayLabel,
  formatMonthName,
  formatStreak,
  summarizeActivity,
} from '../core/activity-stats';
import {
  buildContributionGrid,
  type ContributionDay,
  type ContributionWeek,
  type HeatmapGeometry,
  heatmapGeometry,
} from '../core/contribution-grid';
import type { ActivityOverview } from '../core/event';
import type { ActivityIntensity } from '../core/intensity';

const WEEKDAY_LABELS = ['', 'M', '', 'W', '', 'F', ''];

// Cell geometry arrives as CSS variables from `heatmapGeometry`, in px rather
// than rem so the fit holds when Dynamic Type scales the root font size.
const CELL_CLASS = 'size-(--heatmap-cell)';
const COLUMN_CLASS = 'w-(--heatmap-cell)';
const GAP_CLASS = 'gap-(--heatmap-gap)';
const MONTH_ROW_CLASS = 'mb-1 h-3';

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
 *
 * With `skeleton`, the same layout renders shimmer placeholders in place of
 * the numbers and day cells. Pass a `placeholderOverview` so the geometry
 * matches the card that replaces it.
 *
 * The whole year is always on the board. Cells shrink with the pane down to
 * `HEATMAP_MIN_CELL`, and below that the week area scrolls sideways, opened
 * on the newest week. The geometry comes from measuring the week area.
 */
export function ActionGraph(props: {
  overview: ActivityOverview;
  skeleton?: boolean;
}) {
  const [weekArea, setWeekArea] = createSignal<HTMLDivElement>();
  const weekAreaSize = createElementSize(weekArea);
  const grid = createMemo(() => buildContributionGrid(props.overview));
  const geometry = createMemo(() =>
    heatmapGeometry(weekAreaSize.width, grid().weeks.length)
  );
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
  const skeleton = () => props.skeleton === true;

  return (
    <Layer depth={2}>
      <section
        class="overflow-hidden rounded-lg border border-edge-muted bg-surface"
        aria-labelledby="activity-actions-heading"
        aria-busy={skeleton() || undefined}
        data-activity-graph-skeleton={skeleton() || undefined}
      >
        <div class="divide-y divide-edge-muted text-xs">
          <ActionGraphHeader
            total={props.overview.total}
            skeleton={skeleton()}
          />
          <ContributionHeatmap
            weeks={grid().weeks}
            monthLabels={monthLabels()}
            geometry={geometry()}
            skeleton={skeleton()}
            weekAreaRef={setWeekArea}
          />
          <ActionGraphStats stats={stats()} skeleton={skeleton()} />
        </div>
      </section>
    </Layer>
  );
}

function SkeletonText(props: { class?: string }) {
  return (
    <span
      aria-hidden
      class={cn(
        'skeleton-shimmer inline-block h-3 rounded bg-skeleton align-middle',
        props.class
      )}
    />
  );
}

function ActionGraphHeader(props: { total: number; skeleton: boolean }) {
  return (
    <header class="flex min-h-7 items-center gap-2 px-4 py-2">
      <h2
        id="activity-actions-heading"
        class="font-semibold text-ink-muted text-xs"
      >
        Actions{' '}
        <Show when={!props.skeleton} fallback={<SkeletonText class="w-8" />}>
          <span class="text-ink-extra-muted tabular-nums">
            ({props.total.toLocaleString()})
          </span>
        </Show>
      </h2>
      <IntensityLegend />
    </header>
  );
}

function IntensityLegend() {
  return (
    <div class="ml-auto flex shrink-0 items-center gap-1 text-ink-extra-muted">
      <span class="@max-md/u-list:hidden">Fewer</span>
      <For each={[0, 1, 2, 3, 4] as const}>
        {(level) => (
          <IntensitySwatch level={level} class="size-2.5 rounded-[3px]" />
        )}
      </For>
      <span class="@max-md/u-list:hidden">More</span>
    </div>
  );
}

/**
 * Month letters ride inside each week column so they scroll with the weeks.
 * The week area is measured for the geometry and, when the year still does
 * not fit at the smallest cell, scrolls sideways from the newest week.
 */
function ContributionHeatmap(props: {
  weeks: ContributionWeek[];
  monthLabels: Map<number, string>;
  geometry: HeatmapGeometry;
  skeleton: boolean;
  weekAreaRef: (element: HTMLDivElement) => void;
}) {
  let weekArea: HTMLDivElement | undefined;

  createEffect(() => {
    if (!props.geometry.overflows || !weekArea) return;
    const element = weekArea;
    const frame = requestAnimationFrame(() => {
      element.scrollLeft = element.scrollWidth;
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return (
    <div
      class="flex items-stretch px-4 py-3"
      style={{
        '--heatmap-cell': `${props.geometry.cell}px`,
        '--heatmap-gap': `${props.geometry.gap}px`,
      }}
      data-activity-heatmap
    >
      <WeekdayGutter />
      <div
        ref={(element) => {
          weekArea = element;
          props.weekAreaRef(element);
        }}
        class="min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-activity-heatmap-weeks
      >
        <div class={cn('flex w-max', GAP_CLASS)}>
          <For each={props.weeks}>
            {(week, index) => (
              <HeatmapWeek
                week={week}
                monthLabel={props.monthLabels.get(index())}
                skeleton={props.skeleton}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function WeekdayGutter() {
  return (
    <div
      class={cn(
        'mr-1.5 flex w-3.5 shrink-0 flex-col text-ink-extra-muted text-xs',
        GAP_CLASS
      )}
    >
      <span aria-hidden class={cn('shrink-0', MONTH_ROW_CLASS)} />
      <For each={WEEKDAY_LABELS}>
        {(label) => (
          <span
            class={cn('flex items-center leading-none', 'h-(--heatmap-cell)')}
          >
            {label}
          </span>
        )}
      </For>
    </div>
  );
}

function HeatmapWeek(props: {
  week: ContributionWeek;
  monthLabel?: string;
  skeleton: boolean;
}) {
  return (
    <div class={cn('flex shrink-0 flex-col', COLUMN_CLASS, GAP_CLASS)}>
      <span
        class={cn(
          'shrink-0 overflow-visible text-center text-ink-extra-muted text-xs leading-none',
          MONTH_ROW_CLASS
        )}
      >
        {props.monthLabel}
      </span>
      <For each={props.week}>
        {(day) => <DaySquare day={day} skeleton={props.skeleton} />}
      </For>
    </div>
  );
}

function DaySquare(props: { day: ContributionDay | null; skeleton: boolean }) {
  const day = props.day;
  if (!day) {
    return <span class={cn('shrink-0', CELL_CLASS)} />;
  }

  const label = actionLabel(day);
  return (
    <Show
      when={!props.skeleton}
      fallback={
        <span
          aria-hidden
          data-activity-day
          class={cn(
            'skeleton-shimmer block shrink-0 rounded-[3px] bg-skeleton',
            CELL_CLASS
          )}
        />
      }
    >
      <Tooltip
        as="span"
        placement="top"
        class={cn('block shrink-0', CELL_CLASS)}
        label={label}
      >
        <IntensitySwatch
          level={day.intensity}
          class="block size-full rounded-[3px]"
          aria-label={label}
          data-activity-day
        />
      </Tooltip>
    </Show>
  );
}

function IntensitySwatch(props: {
  level: ActivityIntensity;
  class?: string;
  'aria-label'?: string;
  'data-activity-day'?: boolean;
}) {
  return (
    <span
      aria-label={props['aria-label']}
      data-activity-day={props['data-activity-day'] || undefined}
      class={cn(
        match(props.level)
          .with(0, () => 'bg-ink/10')
          .with(1, () => 'bg-accent/25')
          .with(2, () => 'bg-accent/45')
          .with(3, () => 'bg-accent/70')
          .with(4, () => 'bg-accent')
          .exhaustive(),
        props.class
      )}
    />
  );
}

function ActionGraphStats(props: { stats: ActivityStats; skeleton: boolean }) {
  return (
    <dl class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 @max-2xl/u-list:grid @max-2xl/u-list:grid-cols-2 @max-md/u-list:gap-y-2">
      <Stat
        label="Most active month"
        value={monthStat(props.stats.mostActiveMonth)}
        skeleton={props.skeleton}
      />
      <Stat
        label="Most active day"
        value={dayStat(props.stats.mostActiveDay)}
        skeleton={props.skeleton}
      />
      <Stat
        label="Longest streak"
        value={formatStreak(props.stats.longestStreak)}
        skeleton={props.skeleton}
      />
      <Stat
        label="Current streak"
        value={formatStreak(props.stats.currentStreak)}
        skeleton={props.skeleton}
      />
    </dl>
  );
}

function Stat(props: { label: string; value: string; skeleton: boolean }) {
  return (
    <div class="flex min-w-0 items-center gap-1.5 @max-md/u-list:flex-col @max-md/u-list:items-start @max-md/u-list:gap-0">
      <dt class="shrink-0 text-ink-extra-muted">{props.label}</dt>
      <dd class="min-w-0 max-w-full truncate font-medium text-ink tabular-nums">
        <Show when={!props.skeleton} fallback={<SkeletonText class="w-12" />}>
          {props.value}
        </Show>
      </dd>
    </div>
  );
}
