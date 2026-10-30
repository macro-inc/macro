import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import { WEEKDAY_OPTIONS } from '@core/util/cron';
import { parseTime } from '@core/util/dateSearch/parseTime';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, cn, Input, Tabs } from '@ui';
import { addDays, format } from 'date-fns';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';
import {
  type ScheduleTriggerDraft,
  triggerFrequencies,
} from '../core/routine-triggers';
import { parseRecurringSchedule } from '../core/schedule-language';

const timezones = Intl.supportedValuesOf('timeZone');

function zoneLabel(zone: string) {
  return zone.replace(/_/g, ' ');
}

/** A stored `HH:mm` time as people read it, e.g. "9:00 AM". */
function clockTime(time: string) {
  const date = new Date(`2000-01-01T${time}`);
  return Number.isFinite(date.getTime()) ? format(date, 'h:mm a') : time;
}

/** A labelled field of a trigger panel. */
function Field(props: {
  label: string;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <div class={cn('grid min-w-0 gap-1.5', props.class)}>
      <span class="text-xs font-medium text-ink-muted">{props.label}</span>
      {props.children}
    </div>
  );
}

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
    query: () =>
      search()
        .trim()
        .replace(/^in\s+/i, ''),
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
            <Button
              variant="ghost"
              size="sm"
              class="justify-self-start"
              onClick={() => setCalendar(false)}
            >
              <CaretLeftIcon class="size-3.5" />
              Type a date instead
            </Button>
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
        <Input
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
        />
        <div class="-mx-1.5 grid gap-0.5" aria-label="Suggested dates">
          <For each={options()}>
            {(option) => (
              <button
                type="button"
                aria-pressed={selected()?.getTime() === option.date.getTime()}
                class="flex min-h-8 flex-col rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-ink/5 focus-visible:bg-ink/5 aria-pressed:bg-ink/5 touch:min-h-11"
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
            <p class="px-2 py-1.5 text-xs text-ink-muted">
              Try “tomorrow 9am”, or pick a date.
            </p>
          </Show>
          <button
            type="button"
            class="flex min-h-8 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-ink/5 focus-visible:bg-ink/5 touch:min-h-11"
            onClick={() => setCalendar(true)}
          >
            <CalendarIcon class="size-4 shrink-0 text-ink-muted" />
            Custom date and time…
          </button>
        </div>
      </Show>
      <p role="status" class="text-xs leading-4 text-ink-muted">
        <Show
          when={selected()}
          fallback={`Runs once, in ${zoneLabel(props.trigger.timezone)}`}
        >
          {(date) => (
            <>
              Run on {format(date(), 'MMM d, yyyy · h:mm a')} ·{' '}
              {zoneLabel(props.trigger.timezone)}
            </>
          )}
        </Show>
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
  const [timeText, setTimeText] = createSignal(clockTime(props.trigger.time));
  const describe = (text: string) => {
    setWords(text);
    const parts = parseRecurringSchedule(text);
    if (!parts) return;
    props.onChange(parts);
    setTimeText(clockTime(parts.time));
  };
  const hasTime = () =>
    props.trigger.frequency !== 'hour' && props.trigger.frequency !== 'custom';
  return (
    <Show
      when={choosingZone()}
      fallback={
        <div class="grid gap-3.5">
          <Field label="Describe it">
            <div class="relative">
              <Input
                ref={inputRef}
                aria-label="Describe schedule"
                placeholder="every weekday at 9am"
                value={words()}
                onInput={(e) => describe(e.currentTarget.value)}
                class="pr-8"
              />
              <Show when={parsed()}>
                <CheckIcon
                  aria-label="Understood"
                  class="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-success"
                />
              </Show>
            </div>
            <Show when={words() && !parsed()}>
              <span class="text-xs text-ink-muted">
                Try “every day at 9am”, or set it below.
              </span>
            </Show>
          </Field>
          <Field label="Repeat">
            <Tabs
              aria-label="Repeat"
              size="sm"
              options={triggerFrequencies
                .filter((item) => item.value !== 'once')
                .map((item) => ({
                  value: item.value,
                  label: item.value === 'custom' ? 'Cron' : item.label,
                }))}
              value={props.trigger.frequency}
              onChange={(frequency) => {
                setWords('');
                props.onChange({ frequency });
              }}
            />
          </Field>
          <Show when={props.trigger.frequency === 'week'}>
            <Field label="On">
              <div
                class="flex gap-1.5"
                role="group"
                aria-label="Days of the week"
              >
                <For each={WEEKDAY_OPTIONS}>
                  {(day) => (
                    <Button
                      // A chosen day reads at a glance, as selected pills do.
                      variant={
                        props.trigger.daysOfWeek.includes(day.value)
                          ? 'primary'
                          : 'secondary'
                      }
                      size="icon-sm"
                      class="text-xxs"
                      aria-label={day.fullLabel}
                      aria-pressed={props.trigger.daysOfWeek.includes(
                        day.value
                      )}
                      onClick={() =>
                        props.onChange({
                          daysOfWeek: props.trigger.daysOfWeek.includes(
                            day.value
                          )
                            ? props.trigger.daysOfWeek.filter(
                                (value) => value !== day.value
                              )
                            : [...props.trigger.daysOfWeek, day.value],
                        })
                      }
                    >
                      {day.label[0]}
                    </Button>
                  )}
                </For>
              </div>
            </Field>
          </Show>
          <Show when={props.trigger.frequency === 'custom'}>
            <Field label="Cron expression">
              <Input
                aria-label="Cron expression"
                value={props.trigger.cron}
                onInput={(e) => props.onChange({ cron: e.currentTarget.value })}
                class="font-mono"
              />
              <span class="text-xs leading-4 text-ink-muted">
                Seconds, minutes, hours, day, month, weekday, optional year.
              </span>
            </Field>
          </Show>
          <div class="grid grid-cols-2 gap-2.5">
            <Show when={props.trigger.frequency === 'month'}>
              <Field label="Day of month" class="col-span-2">
                <Input
                  type="number"
                  min="1"
                  max="31"
                  aria-label="Day of month"
                  value={props.trigger.dayOfMonth}
                  onInput={(e) =>
                    props.onChange({ dayOfMonth: e.currentTarget.value })
                  }
                />
              </Field>
            </Show>
            <Show when={hasTime()}>
              <Field label="At">
                <Input
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
                />
              </Field>
            </Show>
            <Field
              label="Time zone"
              class={hasTime() ? undefined : 'col-span-2'}
            >
              <Button
                ref={zoneButton}
                variant="outline"
                size="md"
                aria-label={`Time zone: ${zoneLabel(props.trigger.timezone)}`}
                class="w-full justify-between"
                onClick={() => setChoosingZone(true)}
              >
                <span class="min-w-0 truncate">
                  {zoneLabel(props.trigger.timezone)}
                </span>
                <CaretRightIcon class="size-3 shrink-0" />
              </Button>
            </Field>
          </div>
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
      zoneLabel(zone).toLowerCase().includes(search().trim().toLowerCase())
    );
  return (
    <div class="grid gap-2">
      <Button
        variant="ghost"
        size="sm"
        class="justify-self-start"
        onClick={props.onBack}
      >
        <CaretLeftIcon class="size-3.5" />
        Back to schedule
      </Button>
      <Input
        ref={inputRef}
        aria-label="Search time zones"
        placeholder="Search time zones…"
        value={search()}
        onInput={(e) => setSearch(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && options()[0]) {
            e.preventDefault();
            props.onChange(options()[0]);
          }
        }}
      />
      <div class="-mx-1.5 max-h-56 overflow-y-auto" aria-label="Time zones">
        <For each={options()}>
          {(zone) => (
            <button
              type="button"
              aria-pressed={zone === props.value}
              class="flex min-h-8 w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-ink/5 focus-visible:bg-ink/5 touch:min-h-11"
              onClick={() => props.onChange(zone)}
            >
              {zoneLabel(zone)}
              <Show when={zone === props.value}>
                <CheckIcon class="size-3.5 shrink-0 text-ink-muted" />
              </Show>
            </button>
          )}
        </For>
        <Show when={!options().length}>
          <p class="p-2 text-xs text-ink-muted">No matching time zones</p>
        </Show>
      </div>
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
