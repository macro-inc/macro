import type { ActivityOverview } from '@queries/activity/graphql/overview';
import { Tooltip } from '@ui';
import { createMemo, For } from 'solid-js';
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

const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function dateLabel(date: string): string {
  return dateFormatter.format(Date.parse(`${date}T00:00:00Z`));
}

function contributionLabel(day: ContributionDay): string {
  const noun = day.count === 1 ? 'contribution' : 'contributions';
  return `${day.count.toLocaleString()} ${noun} on ${dateLabel(day.date)}`;
}

export function ContributionGraph(props: { overview: ActivityOverview }) {
  const grid = createMemo(() => buildContributionGrid(props.overview));
  const monthLabels = createMemo(
    () =>
      new Map(
        grid().monthLabels.map(({ label, weekIndex }) => [weekIndex, label])
      )
  );
  const heading = () => {
    const noun = props.overview.total === 1 ? 'contribution' : 'contributions';
    return `${props.overview.total.toLocaleString()} ${noun} in the last year`;
  };

  return (
    <section class="min-w-0" aria-labelledby="activity-contributions-heading">
      <h2
        id="activity-contributions-heading"
        class="mb-3 font-medium text-ink text-sm"
      >
        {heading()}
      </h2>
      <div class="overflow-x-auto pb-1">
        <div class="w-max min-w-full">
          <div class="mb-1 flex h-4 gap-[3px] pl-7">
            <For each={grid().weeks}>
              {(_, index) => (
                <span class="w-2.5 shrink-0 whitespace-nowrap text-[10px] text-ink-extra-muted leading-none">
                  {monthLabels().get(index())}
                </span>
              )}
            </For>
          </div>
          <div class="flex gap-0">
            <div class="mr-1 flex w-6 shrink-0 flex-col gap-[3px]">
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
                            label={contributionLabel(day)}
                          >
                            <span
                              aria-label={contributionLabel(day)}
                              class={`block size-full rounded-[2px] ring ring-edge-muted ${INTENSITY_CLASS[day.intensity]}`}
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
          <div class="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-ink-extra-muted">
            <span>Less</span>
            <For each={[0, 1, 2, 3, 4] as const}>
              {(level) => (
                <span
                  class={`size-2.5 rounded-[2px] ring ring-edge-muted ${INTENSITY_CLASS[level]}`}
                />
              )}
            </For>
            <span>More</span>
          </div>
        </div>
      </div>
    </section>
  );
}
