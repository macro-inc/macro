import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import { WEEKDAY_OPTIONS } from '@core/util/cron';
import { parseTime } from '@core/util/dateSearch/parseTime';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import CalendarIcon from '@phosphor/calendar.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import { addDays, format } from 'date-fns';
import { createSignal, For, onMount, Show } from 'solid-js';
import {
  type ScheduleTriggerDraft,
  triggerFrequencies,
} from '../core/routine-triggers';
import { parseRecurringSchedule } from '../core/schedule-language';

const timezones = Intl.supportedValuesOf('timeZone');

/** Macro's natural date search and calendar, rendered inline in the trigger panel. */
function RunOnceSettings(props: {
  trigger: ScheduleTriggerDraft;
  onChange: (patch: Partial<ScheduleTriggerDraft>) => void;
}) {
  let inputRef: HTMLInputElement | undefined;
  onMount(() => inputRef?.focus());
  const [search, setSearch] = createSignal('');
  const [calendar, setCalendar] = createSignal(false);
  const dates = useDateSearch({
    query: search,
    defaultTime: { hours: 9, minutes: 0 },
  });
  const options = () =>
    dates().filter((option) => option.date.getTime() > Date.now());
  const selected = () => {
    const date = new Date(props.trigger.onceAt);
    return Number.isFinite(date.getTime()) ? date : undefined;
  };
  const tomorrow = addDays(new Date(), 1);
  tomorrow.setHours(9, 0, 0, 0);
  return (
    <div class="grid gap-2">
      <Show
        when={!calendar()}
        fallback={
          <>
            <button
              type="button"
              class="px-2 text-left text-xs text-ink-muted hover:text-ink"
              onClick={() => setCalendar(false)}
            >
              Type a date instead
            </button>
            <div class="[&>div]:w-full [&>div]:p-0">
              <DatePickerUI
                value={selected() ?? tomorrow}
                showTimePicker
                disablePriorToDate={new Date()}
                onChange={(date) => {
                  props.onChange({ onceAt: date.toISOString() });
                  setCalendar(false);
                }}
              />
            </div>
          </>
        }
      >
        <input
          ref={inputRef}
          aria-label="Run once date"
          placeholder="Tomorrow 9am, in 2 hours…"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && options()[0]) {
              e.preventDefault();
              props.onChange({ onceAt: options()[0].date.toISOString() });
            }
          }}
          class="w-full rounded-md border border-edge-muted bg-input px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div class="grid gap-0.5" aria-label="Suggested dates">
          <For each={options()}>
            {(option) => (
              <button
                type="button"
                class="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-hover focus-visible:bg-hover outline-none"
                onClick={() =>
                  props.onChange({ onceAt: option.date.toISOString() })
                }
              >
                <span>{option.displayText}</span>
                <span class="text-xs text-ink-muted">
                  {format(option.date, 'MMM d, h:mm a')}
                </span>
              </button>
            )}
          </For>
          <Show when={search() && !options().length}>
            <p class="px-2 py-2 text-xs text-ink-muted">
              Try “tomorrow 9am” or choose a date below.
            </p>
          </Show>
        </div>
        <button
          type="button"
          class="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-ink-muted hover:bg-hover"
          onClick={() => setCalendar(true)}
        >
          <CalendarIcon class="size-4" /> Custom date and time…
        </button>
      </Show>
      <Show when={selected()}>
        {(date) => (
          <p
            role="status"
            class="rounded-md bg-hover px-3 py-2 text-xs text-ink"
          >
            Run on {format(date(), 'MMM d, yyyy · h:mm a')}
          </p>
        )}
      </Show>
      <p class="px-2 text-xs text-ink-extra-muted">
        {Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ')}
      </p>
    </div>
  );
}

function RecurringSettings(props: {
  trigger: ScheduleTriggerDraft;
  onChange: (patch: Partial<ScheduleTriggerDraft>) => void;
}) {
  let inputRef: HTMLInputElement | undefined;
  onMount(() => inputRef?.focus());
  const [choosingZone, setChoosingZone] = createSignal(false);
  let zoneButton: HTMLButtonElement | undefined;
  const [words, setWords] = createSignal('');
  const parsed = () => parseRecurringSchedule(words());
  const [timeText, setTimeText] = createSignal(props.trigger.time);
  const describe = (text: string) => {
    setWords(text);
    const parts = parseRecurringSchedule(text);
    if (!parts) return;
    props.onChange(parts);
    setTimeText(parts.time);
  };
  return (
    <Show
      when={choosingZone()}
      fallback={
        <div class="grid gap-4">
          <input
            ref={inputRef}
            aria-label="Describe schedule"
            placeholder="Every weekday at 9am"
            value={words()}
            onInput={(e) => describe(e.currentTarget.value)}
            class="w-full rounded-md border border-edge-muted bg-input px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <Show when={words() && !parsed()}>
            <p class="text-xs text-ink-muted">
              Try “every day at 9am”, or choose below.
            </p>
          </Show>
          <div class="flex flex-wrap gap-1" role="group" aria-label="Repeat">
            <For
              each={triggerFrequencies.filter((item) => item.value !== 'once')}
            >
              {(item) => (
                <button
                  type="button"
                  class={cn(
                    'rounded-md px-2 py-1.5 text-xs hover:bg-hover',
                    props.trigger.frequency === item.value
                      ? 'bg-hover text-ink'
                      : 'text-ink-muted'
                  )}
                  aria-pressed={props.trigger.frequency === item.value}
                  onClick={() => {
                    setWords('');
                    props.onChange({ frequency: item.value });
                  }}
                >
                  {item.value === 'custom' ? 'Cron' : item.label}
                </button>
              )}
            </For>
          </div>
          <Show when={props.trigger.frequency === 'week'}>
            <div class="flex gap-1" role="group" aria-label="Days of the week">
              <For each={WEEKDAY_OPTIONS}>
                {(day) => (
                  <button
                    type="button"
                    aria-pressed={props.trigger.daysOfWeek.includes(day.value)}
                    class={cn(
                      'flex-1 rounded-md py-1.5 text-xs hover:bg-hover',
                      props.trigger.daysOfWeek.includes(day.value)
                        ? 'bg-hover text-ink'
                        : 'text-ink-muted'
                    )}
                    onClick={() =>
                      props.onChange({
                        daysOfWeek: props.trigger.daysOfWeek.includes(day.value)
                          ? props.trigger.daysOfWeek.filter(
                              (value) => value !== day.value
                            )
                          : [...props.trigger.daysOfWeek, day.value],
                      })
                    }
                  >
                    {day.label}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={props.trigger.frequency === 'month'}>
            <label class="flex items-center justify-between gap-3 text-xs text-ink-muted">
              Day of month
              <input
                type="number"
                min="1"
                max="31"
                value={props.trigger.dayOfMonth}
                onInput={(e) =>
                  props.onChange({ dayOfMonth: e.currentTarget.value })
                }
                class="w-16 rounded-md border border-edge-muted bg-input px-2 py-1.5 text-sm text-ink"
              />
            </label>
          </Show>
          <Show
            when={
              props.trigger.frequency !== 'hour' &&
              props.trigger.frequency !== 'custom'
            }
          >
            <label class="flex items-center justify-between gap-3 text-xs text-ink-muted">
              Time
              <input
                aria-label="Run time"
                placeholder="9:00 AM"
                value={timeText()}
                onInput={(e) => {
                  const text = e.currentTarget.value;
                  setTimeText(text);
                  const parsed = parseTime(text);
                  const time =
                    parsed && !parsed.rest
                      ? `${String(parsed.time.hours).padStart(2, '0')}:${String(parsed.time.minutes).padStart(2, '0')}`
                      : text;
                  props.onChange({ time });
                }}
                class="w-28 rounded-md border border-edge-muted bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
          </Show>
          <Show when={props.trigger.frequency === 'custom'}>
            <label class="grid gap-2 text-xs text-ink-muted">
              Cron expression
              <input
                aria-label="Cron expression"
                value={props.trigger.cron}
                onInput={(e) => props.onChange({ cron: e.currentTarget.value })}
                class="w-full rounded-md border border-edge-muted bg-input p-2 font-mono text-sm text-ink outline-none focus:border-accent"
              />
              <span>
                Seconds, minutes, hours, day, month, weekday, optional year.
              </span>
            </label>
          </Show>
          <button
            ref={zoneButton}
            type="button"
            aria-label="Timezone"
            class="flex w-full items-center justify-between gap-3 rounded-md py-1 text-xs text-ink-muted hover:text-ink"
            onClick={() => setChoosingZone(true)}
          >
            <span>Time zone</span>
            <span class="ml-auto truncate">
              {props.trigger.timezone.replace(/_/g, ' ')}
            </span>
            <CaretRightIcon class="size-3 shrink-0" />
          </button>
        </div>
      }
    >
      <TimezoneChoices
        value={props.trigger.timezone}
        onChange={(timezone) => {
          props.onChange({ timezone });
          setChoosingZone(false);
          queueMicrotask(() => zoneButton?.focus());
        }}
        onBack={() => {
          setChoosingZone(false);
          queueMicrotask(() => zoneButton?.focus());
        }}
      />
    </Show>
  );
}

function TimezoneChoices(props: {
  value: string;
  onChange: (value: string) => void;
  onBack: () => void;
}) {
  let inputRef: HTMLInputElement | undefined;
  onMount(() => inputRef?.focus());
  const [search, setSearch] = createSignal('');
  const options = () =>
    [...new Set([props.value, 'UTC', ...timezones])].filter((zone) =>
      zone
        .replace(/_/g, ' ')
        .toLowerCase()
        .includes(search().trim().toLowerCase())
    );
  return (
    <div class="grid gap-2">
      <input
        ref={inputRef}
        aria-label="Search timezones"
        placeholder="Search time zones…"
        value={search()}
        onInput={(e) => setSearch(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && options()[0]) {
            e.preventDefault();
            props.onChange(options()[0]);
          }
        }}
        class="w-full rounded-md border border-edge-muted bg-input px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div class="max-h-48 overflow-y-auto" aria-label="Time zones">
        <For each={options()}>
          {(zone) => (
            <button
              type="button"
              aria-pressed={zone === props.value}
              class="block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-hover focus-visible:bg-hover outline-none"
              onClick={() => props.onChange(zone)}
            >
              {zone.replace(/_/g, ' ')}
            </button>
          )}
        </For>
        <Show when={!options().length}>
          <p class="p-2 text-xs text-ink-muted">No matching time zones</p>
        </Show>
      </div>
      <button
        type="button"
        class="px-2 py-1 text-left text-xs text-ink-muted hover:text-ink"
        onClick={props.onBack}
      >
        Back to schedule
      </button>
    </div>
  );
}

export function RoutineScheduleSettings(props: {
  trigger: ScheduleTriggerDraft;
  onChange: (patch: Partial<ScheduleTriggerDraft>) => void;
}) {
  return (
    <Show
      when={props.trigger.frequency === 'once'}
      fallback={<RecurringSettings {...props} />}
    >
      <RunOnceSettings {...props} />
    </Show>
  );
}
