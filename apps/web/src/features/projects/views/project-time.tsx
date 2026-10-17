import { UserIcon } from '@core/component/UserIcon';
import ClockIcon from '@phosphor/clock.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { scaleOrdinal } from 'd3-scale';
import { arc, type PieArcDatum, pie } from 'd3-shape';
import { createMemo, For, Show } from 'solid-js';
import type { ProjectTimeData } from '../queries/project-time';

export type ProjectTimeProps = {
  projectId: string;
  projectName: string;
  data: ProjectTimeData | undefined;
  isLoading: boolean;
};

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

const TIME_CHART_PALETTE = [
  '#4f46e5',
  '#0891b2',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#db2777',
  '#0d9488',
];

function TimeByPersonChart(props: { data: ProjectTimeData }) {
  const diameter = 200;
  const radius = diameter / 2;

  const chartData = createMemo(() =>
    props.data.byPerson.map((p) => ({
      label: p.userName,
      value: p.totalMinutes,
    }))
  );

  const color = createMemo(() =>
    scaleOrdinal<string, string>()
      .domain(chartData().map((d) => d.label))
      .range(TIME_CHART_PALETTE)
  );

  const slices = createMemo(() =>
    pie<{ label: string; value: number }>()
      .sort(null)
      .value((d) => d.value)(chartData())
  );

  const slicePath = () =>
    arc<PieArcDatum<{ label: string; value: number }>>()
      .innerRadius(radius * 0.5)
      .outerRadius(radius - 1);

  return (
    <div class="flex flex-col items-center gap-4">
      <svg
        viewBox={`${-radius} ${-radius} ${diameter} ${diameter}`}
        width={diameter}
        height={diameter}
        class="block overflow-visible"
      >
        <For each={slices()}>
          {(slice) => (
            <path
              d={slicePath()(slice) ?? ''}
              fill={color()(slice.data.label)}
              class="stroke-panel"
              stroke-width="2"
            />
          )}
        </For>
        <text
          text-anchor="middle"
          dominant-baseline="middle"
          class="fill-ink text-lg font-semibold"
        >
          {formatDuration(props.data.totalMinutes)}
        </text>
      </svg>
      <ul class="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
        <For each={chartData()}>
          {(item) => (
            <li class="flex items-center gap-2">
              <span
                class="size-3 rounded-full shrink-0"
                style={{ 'background-color': color()(item.label) }}
              />
              <span class="text-ink-muted">{item.label}</span>
              <span class="font-medium">{formatDuration(item.value)}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

/** Project timesheet view showing time logged by person and task. */
export function ProjectTimeView(props: ProjectTimeProps) {
  return (
    <div class="h-full overflow-y-auto px-6 pb-8 pt-12 touch:pt-6">
      <div class="mx-auto max-w-3xl">
        <div class="mb-8 flex items-center gap-3">
          <ClockIcon class="size-6 text-ink-muted" />
          <h2 class="text-xl font-semibold">Time Tracking</h2>
        </div>

        <Show
          when={!props.isLoading}
          fallback={
            <div class="flex items-center justify-center py-12">
              <SpinnerIcon class="size-8 animate-spin text-ink-muted" />
            </div>
          }
        >
          <Show
            when={
              props.data && props.data.byPerson.length > 0 ? props.data : false
            }
            fallback={
              <div class="text-center text-ink-muted py-12">
                <ClockIcon class="mx-auto size-12 mb-4 opacity-50" />
                <p>No time logged yet</p>
                <p class="text-sm mt-2">
                  Log time on tasks to see the timesheet here
                </p>
              </div>
            }
          >
            {(data) => (
              <>
                <div class="mb-8 rounded-lg border border-edge bg-panel p-6">
                  <TimeByPersonChart data={data()} />
                </div>

                <h3 class="mb-4 text-lg font-medium">By Person</h3>
                <div class="space-y-4">
                  <For each={data().byPerson}>
                    {(person) => (
                      <div class="rounded-lg border border-edge bg-panel p-4">
                        <div class="flex items-center gap-3 mb-3">
                          <Show
                            when={person.userId !== 'unassigned'}
                            fallback={
                              <div class="size-8 rounded-full bg-surface-muted flex items-center justify-center text-ink-muted text-xs">
                                ?
                              </div>
                            }
                          >
                            <UserIcon
                              id={person.userId}
                              size="md"
                              showTooltip={false}
                            />
                          </Show>
                          <div class="flex-1 min-w-0">
                            <div class="font-medium truncate">
                              {person.userName}
                            </div>
                            <div class="text-sm text-ink-muted">
                              {formatDuration(person.totalMinutes)}
                            </div>
                          </div>
                        </div>
                        <div class="ml-11 space-y-2">
                          <For each={person.tasks}>
                            {(task) => (
                              <div class="flex items-center justify-between text-sm">
                                <span class="text-ink-muted truncate">
                                  {task.taskName}
                                </span>
                                <span class="shrink-0 ml-2">
                                  {formatDuration(task.minutes)}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}
