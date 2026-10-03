import { cn } from '@ui';
import { For, Show } from 'solid-js';
import { AutomationTimePicker } from './AutomationTimePicker';
import {
  describeSchedule,
  FREQUENCY_OPTIONS,
  getDefaultTimezone,
  WEEKDAY_OPTIONS,
} from './automationUtils';
import type { ScheduleDraft } from './types';

export function RoutineScheduleFields(props: {
  draft: ScheduleDraft;
  onChange: (update: (draft: ScheduleDraft) => ScheduleDraft) => void;
}) {
  const patch = (fields: Partial<ScheduleDraft>) =>
    props.onChange((draft) => ({ ...draft, ...fields }));
  return (
    <div class="grid gap-4">
      <p class="text-xs text-ink-muted">
        {describeSchedule(props.draft, getDefaultTimezone())}
      </p>
      <div class="flex flex-wrap gap-1" role="group" aria-label="Repeat">
        <For each={FREQUENCY_OPTIONS}>
          {(option) => (
            <button
              type="button"
              aria-pressed={props.draft.frequency === option.value}
              class={cn(
                'rounded-md px-3 py-1.5 text-xs transition-colors',
                props.draft.frequency === option.value
                  ? 'bg-hover text-ink'
                  : 'text-ink-muted hover:bg-hover'
              )}
              onClick={() => patch({ frequency: option.value })}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
      <Show
        when={props.draft.frequency === 'once'}
        fallback={
          <>
            <Show when={props.draft.frequency === 'week'}>
              <div class="flex flex-wrap gap-1" role="group" aria-label="Days">
                <For each={WEEKDAY_OPTIONS}>
                  {(day) => (
                    <button
                      type="button"
                      aria-pressed={props.draft.daysOfWeek.includes(day.value)}
                      class={cn(
                        'rounded-md border px-2.5 py-1.5 text-xs',
                        props.draft.daysOfWeek.includes(day.value)
                          ? 'border-accent/30 bg-accent/10 text-accent'
                          : 'border-edge-muted text-ink-muted hover:bg-hover'
                      )}
                      onClick={() =>
                        patch({
                          daysOfWeek: props.draft.daysOfWeek.includes(day.value)
                            ? props.draft.daysOfWeek.filter(
                                (value) => value !== day.value
                              )
                            : [...props.draft.daysOfWeek, day.value],
                        })
                      }
                    >
                      {day.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={props.draft.frequency === 'month'}>
              <label class="grid gap-1.5 text-xs text-ink-muted">
                Day of month
                <input
                  type="number"
                  min="1"
                  max="31"
                  class="w-24 rounded-md border border-edge-muted bg-input p-2 text-sm text-ink"
                  value={props.draft.dayOfMonth}
                  onInput={(e) => patch({ dayOfMonth: e.currentTarget.value })}
                />
              </label>
            </Show>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="grid gap-1.5">
                <span class="text-xs text-ink-muted">Time</span>
                <AutomationTimePicker
                  value={props.draft.time}
                  onChange={(time) => patch({ time })}
                />
              </div>
              <label class="grid gap-1.5 text-xs text-ink-muted">
                Time zone
                <input
                  class="min-w-0 rounded-md border border-edge-muted bg-input p-2 text-sm text-ink"
                  value={props.draft.timezone ?? getDefaultTimezone()}
                  onInput={(e) => patch({ timezone: e.currentTarget.value })}
                />
              </label>
            </div>
          </>
        }
      >
        <label class="grid gap-1.5 text-xs text-ink-muted">
          Run at (your local time)
          <input
            type="datetime-local"
            step="1"
            class="rounded-md border border-edge-muted bg-input p-2 text-sm text-ink"
            value={props.draft.onceAt ?? ''}
            onInput={(e) => patch({ onceAt: e.currentTarget.value })}
          />
        </label>
      </Show>
    </div>
  );
}
