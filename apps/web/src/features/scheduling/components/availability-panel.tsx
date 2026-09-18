import Clock from '@phosphor/clock.svg';
import Globe from '@phosphor/globe.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { AvailabilitySchedule, SchedulingProfile } from '../core/types';
import { WEEKDAYS } from '../core/types';

export function AvailabilityPanel(props: {
  profile: SchedulingProfile;
  canEdit: boolean;
  saving: boolean;
  onEdit: (schedule: AvailabilitySchedule) => void;
  onDefault: (schedule: AvailabilitySchedule) => void;
  onDelete: (schedule: AvailabilitySchedule) => void;
}) {
  const [remove, setRemove] = createSignal<string>();
  const defaultId = () =>
    props.profile.defaultScheduleId ?? props.profile.schedules[0]?.id;
  const usedBy = (id: string) =>
    props.profile.eventTypes.filter((e) => e.scheduleId === id);
  return (
    <div class="overflow-hidden rounded-xl border border-edge-muted bg-panel">
      <For
        each={props.profile.schedules}
        fallback={
          <div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <Clock class="size-7 text-ink-muted" />
            <h2 class="font-semibold">Set your working hours</h2>
            <p class="text-sm text-ink-muted">
              Create a schedule to start accepting bookings.
            </p>
          </div>
        }
      >
        {(schedule) => (
          <article class="border-b border-edge-muted px-6 py-5 last:border-b-0">
            <div class="flex flex-wrap items-start justify-between gap-5">
              <button
                type="button"
                class="min-w-0 flex-1 text-left"
                disabled={!props.canEdit}
                onClick={() => props.onEdit(schedule)}
              >
                <div class="flex items-center gap-3">
                  <h2 class="font-semibold">{schedule.name}</h2>
                  <Show when={defaultId() === schedule.id}>
                    <span class="rounded-md bg-active px-2 py-0.5 text-xs text-ink-muted">
                      Default
                    </span>
                  </Show>
                </div>
                <div class="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
                  <span class="inline-flex items-center gap-1.5">
                    <Clock class="size-4" />
                    {schedule.weekly
                      .filter((d) => d.windows.length)
                      .map((d) => WEEKDAYS[d.day].slice(0, 3))
                      .join(', ') || 'No available days'}
                  </span>
                  <span class="inline-flex items-center gap-1.5">
                    <Globe class="size-4" />
                    {schedule.timeZone.replaceAll('_', ' ')}
                  </span>
                </div>
                <p class="mt-2 text-xs text-ink-muted">
                  {usedBy(schedule.id).length} event types ·{' '}
                  {schedule.overrides.length} date overrides
                </p>
              </button>
              <Show when={props.canEdit}>
                <div class="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => props.onEdit(schedule)}
                  >
                    Edit
                  </Button>
                  <Show when={defaultId() !== schedule.id}>
                    <Button
                      variant="ghost"
                      disabled={props.saving}
                      onClick={() => props.onDefault(schedule)}
                    >
                      Set as default
                    </Button>
                  </Show>
                  <Button
                    variant="ghost"
                    onClick={() => setRemove(schedule.id)}
                  >
                    Delete
                  </Button>
                </div>
              </Show>
            </div>
            <Show when={props.canEdit && remove() === schedule.id}>
              <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-edge-muted pt-4">
                <p class="flex-1 text-sm">
                  {usedBy(schedule.id).length
                    ? `Move ${usedBy(schedule.id)
                        .map((e) => e.title)
                        .join(
                          ', '
                        )} to another schedule before deleting this one.`
                    : `Delete “${schedule.name}”?`}
                </p>
                <Button variant="ghost" onClick={() => setRemove(undefined)}>
                  Keep schedule
                </Button>
                <Show when={!usedBy(schedule.id).length}>
                  <Button
                    variant="outline"
                    disabled={props.saving}
                    onClick={() => props.onDelete(schedule)}
                  >
                    Delete schedule
                  </Button>
                </Show>
              </div>
            </Show>
          </article>
        )}
      </For>
    </div>
  );
}
