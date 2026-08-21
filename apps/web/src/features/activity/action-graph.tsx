import type { ActivityOverview } from '@queries/activity/graphql/overview';
import { Tooltip } from '@ui';
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
    <section
      class="rounded-2xl bg-inset px-5 py-5 ring ring-edge-muted"
      aria-labelledby="activity-actions-heading"
    >
      <header class="mb-5">
        <p
          id="activity-actions-heading"
          class="text-[11px] text-ink-extra-muted"
        >
          Actions
        </p>
        <p class="mt-1 font-medium text-3xl text-ink tabular-nums tracking-tight">
          {props.overview.total.toLocaleString()}
        </p>
      </header>
      <div class="overflow-x-auto scrollbar-hidden">
        <div class="w-max min-w-full">
          <div class="mb-1 flex h-4 gap-[3px] pl-5">
            <For each={grid().weeks}>
              {(_, index) => (
                <span class="w-2.5 shrink-0 text-center text-[10px] text-ink-extra-muted leading-none">
                  {monthLabels().get(index())}
                </span>
              )}
            </For>
          </div>
          <div class="flex gap-0">
            <div class="mr-1.5 flex w-3.5 shrink-0 flex-col gap-[3px]">
              <For each={WEEKDAY_LABELS}>
                {(label) => (
                  <span class="h-2.5 text-[10px] text-ink-extra-muted leading-2.5">
                    {label}
                  </span>
                )}
              </For>
            </div>
            <div class="flex gap-[3px]">
              <For each={grid().weeks}>
                {(week) => (
                  <div class="flex flex-col gap-[3px]">
                    <For each={week}>
                      {(day) =>
                        day ? (
                          <Tooltip
                            as="span"
                            placement="top"
                            class="size-2.5 shrink-0"
                            label={actionLabel(day)}
                          >
                            <span
                              aria-label={actionLabel(day)}
                              class={`block size-full rounded-[3px] ${INTENSITY_CLASS[day.intensity]}`}
                            />
                          </Tooltip>
                        ) : (
                          <span class="size-2.5 shrink-0" />
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
      <dl class="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat
          label="Most Active Month"
          value={monthStat(stats().mostActiveMonth)}
        />
        <Stat label="Most Active Day" value={dayStat(stats().mostActiveDay)} />
        <Stat
          label="Longest Streak"
          value={formatStreak(stats().longestStreak)}
        />
        <Stat
          label="Current Streak"
          value={formatStreak(stats().currentStreak)}
        />
      </dl>
      <div class="mt-5 flex items-center gap-1.5 text-[10px] text-ink-extra-muted">
        <span>Fewer</span>
        <For each={[0, 1, 2, 3, 4] as const}>
          {(level) => (
            <span class={`size-2.5 rounded-[3px] ${INTENSITY_CLASS[level]}`} />
          )}
        </For>
        <span>More</span>
      </div>
    </section>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div class="min-w-0">
      <dt class="text-[11px] text-ink-extra-muted">{props.label}</dt>
      <dd class="mt-0.5 truncate font-medium text-ink text-sm">
        {props.value}
      </dd>
    </div>
  );
}
