import { For, Show } from 'solid-js';
import {
  type AvailabilityTimeFormat,
  availabilityTimeLabel,
} from '../core/availability-month';
import type { AvailabilityHours } from '../core/availability-selection';

/** A read-only summary of complete hours, including explicit time off. */
export function AvailabilityHoursSummary(props: {
  hours: AvailabilityHours;
  timeFormat: AvailabilityTimeFormat;
}) {
  return (
    <div class="flex min-w-0 flex-col gap-1.5 text-sm">
      <For each={props.hours.windows}>
        {(window) => (
          <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              aria-hidden="true"
              class="size-1.5 shrink-0 rounded-full bg-accent"
            />
            <span class="tabular-nums">
              {availabilityTimeLabel(window, props.timeFormat)}
            </span>
            <Show when={props.hours.unavailableWindows.length}>
              <span class="text-xs text-ink-muted">Available</span>
            </Show>
          </span>
        )}
      </For>
      <For each={props.hours.unavailableWindows}>
        {(window) => (
          <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-muted">
            <span
              aria-hidden="true"
              class="size-1.5 shrink-0 rounded-full bg-ink-extra-muted"
            />
            <span class="tabular-nums">
              {availabilityTimeLabel(window, props.timeFormat)}
            </span>
            <span class="text-xs">Unavailable</span>
          </span>
        )}
      </For>
      <Show
        when={
          !props.hours.windows.length && !props.hours.unavailableWindows.length
        }
      >
        <span class="text-ink-extra-muted">Not set</span>
      </Show>
    </div>
  );
}
