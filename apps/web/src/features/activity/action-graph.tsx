import type { ActivityOverview } from '@queries/activity/graphql/overview';
import { Layer, Tooltip } from '@ui';
import { createMemo, For } from 'solid-js';
import {
  formatDayLabel,
  formatMonthName,
  formatStreak,
  summarizeActivity,
} from './activity-stats';
import {
  buildContributionGrid,
  type ContributionDay,
} from './contribution-grid';
import { INTENSITY_CLASS } from './intensity';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  weekday: 'short',
  year: 'numeric',
});

const WEEKDAY_LABELS = ['', 'M', '', 'W', '', 'F', ''];

/**
 * One week column. Grows to fill the card width, floored at the day-cell size
 * (a very narrow panel scrolls horizontally rather than squashing the cells)
 * and capped so a wide panel spends leftover width on the gaps — via the row's
 * `justify-between` — instead of growing a wall of blocks.
 */
const WEEK_COLUMN_CLASS = 'shrink-0 grow basis-2.5 max-w-3.5';

/** The weeks row and the month-letter row above it, kept column-aligned. */
const WEEK_ROW_CLASS = 'flex flex-1 justify-between gap-[3px]';

/** A day cell, kept square at whatever width its week column settles on. */
const DAY_CELL_CLASS = 'aspect-square w-full shrink-0';

function dateLabel(date: string): string {
  return dateFormatter.format(Date.parse(`${date}T00:00:00Z`));
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
        <header class="flex min-h-7 items-center gap-2 px-4 py-2">
          <h2
            id="activity-actions-heading"
            class="font-semibold text-ink-muted text-xs"
          >
            Actions{' '}
            <span class="text-ink-extra-muted tabular-nums">
              ({props.overview.total.toLocaleString()})
            </span>
          </h2>
          <div class="ml-auto flex shrink-0 items-center gap-1 text-ink-extra-muted">
            <span>Fewer</span>
            <For each={[0, 1, 2, 3, 4] as const}>
              {(level) => (
                <span
                  class={`size-2.5 rounded-[3px] ${INTENSITY_CLASS[level]}`}
                />
              )}
            </For>
            <span>More</span>
          </div>
        </header>
        <div class="overflow-x-auto scrollbar-hidden px-4 py-3">
          <div class="w-max min-w-full">
            <div class={`${WEEK_ROW_CLASS} mb-1 pl-5`}>
              <For each={grid().weeks}>
                {(_, index) => (
                  <span
                    class={`${WEEK_COLUMN_CLASS} text-center text-ink-extra-muted text-xs leading-none`}
                  >
                    {monthLabels().get(index())}
                  </span>
                )}
              </For>
            </div>
            <div class="flex items-stretch">
              <div class="mr-1.5 flex w-3.5 shrink-0 flex-col gap-[3px] text-ink-extra-muted text-xs">
                <For each={WEEKDAY_LABELS}>
                  {(label) => (
                    <span class="flex min-h-0 flex-1 items-center leading-none">
                      {label}
                    </span>
                  )}
                </For>
              </div>
              <div class={WEEK_ROW_CLASS}>
                <For each={grid().weeks}>
                  {(week) => (
                    <div class={`${WEEK_COLUMN_CLASS} flex flex-col gap-[3px]`}>
                      <For each={week}>
                        {(day) =>
                          day ? (
                            <Tooltip
                              as="span"
                              placement="top"
                              class={DAY_CELL_CLASS}
                              label={actionLabel(day)}
                            >
                              <span
                                aria-label={actionLabel(day)}
                                class={`block size-full rounded-[3px] ${INTENSITY_CLASS[day.intensity]}`}
                              />
                            </Tooltip>
                          ) : (
                            <span class={DAY_CELL_CLASS} />
                          )
                        }
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
        <dl class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <Stat
            label="Most active month"
            value={monthStat(stats().mostActiveMonth)}
          />
          <Stat
            label="Most active day"
            value={dayStat(stats().mostActiveDay)}
          />
          <Stat
            label="Longest streak"
            value={formatStreak(stats().longestStreak)}
          />
          <Stat
            label="Current streak"
            value={formatStreak(stats().currentStreak)}
          />
        </dl>
      </div>
    </section>
    </Layer>
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
