import Clock from '@phosphor/clock.svg';
import Plus from '@phosphor/plus.svg';
import Trash from '@phosphor/trash.svg';
import { Button } from '@ui';
import { Index, type JSX, Show } from 'solid-js';
import {
  AVAILABILITY_STEP_MINUTES,
  type AvailabilityIssue,
} from '../core/availability';
import {
  type AvailabilityHourRange,
  nextAvailabilityHourRange,
} from '../core/availability-selection';
import { AvailabilityFieldRow } from './availability-field-row';
import { AvailabilityTypePicker } from './availability-type-picker';
import { CheckField, Field, TextInput } from './fields';

/** Edit a complete day's hours without choosing defaults for differing dates. */
export function AvailabilityHoursEditor(props: {
  ranges?: AvailabilityHourRange[];
  issue?: AvailabilityIssue;
  scope?: 'weekly' | 'dates';
  disabled: boolean;
  onChange: (ranges: AvailabilityHourRange[]) => void;
  header?: JSX.Element;
  children: JSX.Element;
}) {
  let content!: HTMLElement;
  let scrollBody!: HTMLDivElement;
  let addButton!: HTMLButtonElement;
  const hasAllDay = () => props.ranges?.some((range) => range.allDay);
  const nextRange = () => nextAvailabilityHourRange(props.ranges ?? []);
  const update = (index: number, change: Partial<AvailabilityHourRange>) =>
    props.onChange(
      (props.ranges ?? []).map((range, i) =>
        i === index ? { ...range, ...change } : range
      )
    );
  const remove = (index: number) => {
    const remaining = (props.ranges ?? []).filter((_, i) => i !== index);
    props.onChange(remaining);
    queueMicrotask(() => {
      if (!content.isConnected) return;
      const row = content.querySelectorAll<HTMLElement>(
        '[data-availability-range]'
      )[Math.min(index, remaining.length - 1)];
      const control =
        row?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ??
        addButton;
      control.focus();
    });
  };
  return (
    <section
      ref={content}
      aria-label={
        props.scope === 'weekly' ? 'Edit weekly hours' : 'Edit date exception'
      }
      class="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <fieldset
        disabled={props.disabled}
        class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 [@container_availability-exception_(height<24rem)]:gap-2"
      >
        {props.header}
        <div
          ref={scrollBody}
          data-availability-hours-body
          class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain"
          classList={{
            'max-h-[min(24rem,50dvh)] flex-none': props.scope === 'weekly',
          }}
        >
          <ul
            aria-label="Hours"
            class="shrink-0 rounded-xl border border-edge-muted divide-y divide-edge-muted"
          >
            <Index each={props.ranges ?? []}>
              {(range, index) => (
                <li class="p-4">
                  <AvailabilityFieldRow icon={<Clock />}>
                    <div
                      role="group"
                      aria-label={`Hours range ${index + 1}`}
                      data-availability-range
                      class="@container/hours-range flex min-w-0 flex-col gap-3"
                    >
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <AvailabilityTypePicker
                          label={`Range ${index + 1} availability`}
                          mode={range().mode}
                          disabled={props.disabled}
                          onChange={(mode) => update(index, { mode })}
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          label={`Remove range ${index + 1}`}
                          onClick={() => remove(index)}
                        >
                          <Trash class="size-4" />
                        </Button>
                      </div>
                      <div class="grid min-w-0 grid-cols-2 items-end gap-3 @min-[21rem]/hours-range:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <Field label="Start" class="min-w-0 gap-1 text-xs">
                          <TextInput
                            type="time"
                            step={AVAILABILITY_STEP_MINUTES * 60}
                            aria-label={`Start time ${index + 1}`}
                            class="h-9 w-full min-w-0 text-xs"
                            disabled={props.disabled || !!range().allDay}
                            value={range().allDay ? '00:00' : range().start}
                            onInput={(event) =>
                              update(index, {
                                start: event.currentTarget.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="End" class="min-w-0 gap-1 text-xs">
                          <TextInput
                            type="time"
                            step={AVAILABILITY_STEP_MINUTES * 60}
                            aria-label={`End time ${index + 1}`}
                            class="h-9 w-full min-w-0 text-xs"
                            disabled={props.disabled || !!range().allDay}
                            value={range().allDay ? '23:59' : range().end}
                            onInput={(event) =>
                              update(index, { end: event.currentTarget.value })
                            }
                          />
                        </Field>
                        <CheckField
                          label="All day"
                          class="col-span-2 min-h-9 gap-2 text-xs @min-[21rem]/hours-range:col-span-1"
                          checked={!!range().allDay}
                          disabled={props.disabled}
                          onChange={(allDay) => update(index, { allDay })}
                        />
                      </div>
                    </div>
                  </AvailabilityFieldRow>
                </li>
              )}
            </Index>
            <Show when={!props.ranges?.length}>
              <li class="p-4 text-xs leading-relaxed text-ink-muted">
                {props.ranges
                  ? 'No hours set. This time will be blank and non-bookable.'
                  : 'These dates have different hours. Add hours to replace them together.'}
              </li>
            </Show>
          </ul>
          <Show when={!nextRange()}>
            <p class="shrink-0 text-xs leading-relaxed text-ink-muted">
              {hasAllDay()
                ? 'For breaks, turn off All day and use separate time ranges.'
                : 'Finish the last range and leave room for another full hour.'}
            </p>
          </Show>
          <Show when={props.issue}>
            {(issue) => (
              <p
                role="alert"
                class="shrink-0 rounded-lg bg-failure-bg p-3 text-xs leading-relaxed text-failure"
              >
                {issue().message}
              </p>
            )}
          </Show>
        </div>
        <Button
          ref={addButton}
          variant="outline"
          size="sm"
          class="shrink-0 self-start"
          disabled={!nextRange()}
          onClick={() => {
            const next = nextRange();
            if (!next) return;
            const ranges = [...(props.ranges ?? []), next];
            props.onChange(ranges);
            queueMicrotask(() => {
              if (!content.isConnected) return;
              const row = content.querySelectorAll<HTMLElement>(
                '[data-availability-range]'
              )[ranges.length - 1];
              if (!row) return;
              // Scroll only the hours list; keep Add hours and actions in place.
              scrollBody.scrollTop +=
                row.getBoundingClientRect().top -
                scrollBody.getBoundingClientRect().top;
            });
          }}
        >
          <Plus class="size-4" />
          Add hours
        </Button>
        {props.children}
      </fieldset>
    </section>
  );
}
