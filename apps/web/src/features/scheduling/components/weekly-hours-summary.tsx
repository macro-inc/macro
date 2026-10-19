import { For } from 'solid-js';
import { type AvailabilitySchedule, WEEKDAYS } from '../core/types';

export function WeeklyHoursSummary(props: { schedule: AvailabilitySchedule }) {
  return (
    <section
      aria-label="Weekly hours"
      class="mt-2 flex flex-col gap-1.5"
      data-weekly-hours
    >
      <p class="text-xs text-ink-muted">
        Time zone: {props.schedule.timeZone.replaceAll('_', ' ')}
      </p>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <For each={props.schedule.weekly}>
          {(day) => (
            <>
              <dt class="text-ink-muted">{WEEKDAYS[day.day]}</dt>
              <dd class="text-right">
                {day.windows
                  .map((window) => `${window.start}–${window.end}`)
                  .join(', ') || 'Unavailable'}
              </dd>
            </>
          )}
        </For>
      </dl>
    </section>
  );
}
