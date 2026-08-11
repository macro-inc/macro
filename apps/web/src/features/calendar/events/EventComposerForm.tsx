import ArrowRightIcon from '@phosphor/arrow-right.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button, Checkbox, Select } from '@ui';
import { addMonths, format, parseISO } from 'date-fns';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Show,
} from 'solid-js';
import { EventDateTimePill } from './EventDateTimeField';
import {
  EventComposerCalendarPill,
  EventComposerGuestsPill,
  EventComposerLocationPill,
  EventComposerRecurrencePill,
} from './EventComposerPropertyPills';
import {
  buildEventTime,
  convertTimesForAllDay,
  defaultEditorInitialValues,
  type EventEditorCalendarOption,
  type EventEditorGuestOption,
  type EventEditorInitialValues,
  type EventEditorSubmitValues,
  guestEmail,
  moveAllDayRange,
  type SelectedEventEditorGuest,
} from './EventEditorForm';
import {
  buildRecurrenceLines,
  defaultCustomConfig,
  type RecurrenceConfig,
  recurrencePresetsFor,
  WEEKDAY_CODES,
  type WeekdayCode,
} from './recurrence-editor';

const DATE_VALUE = 'yyyy-MM-dd';
type ComposerSelectOption<Value extends string = string> = {
  value: Value;
  label: string;
};

const REPEAT_FREQUENCY_OPTIONS: ComposerSelectOption<
  RecurrenceConfig['frequency']
>[] = [
  { value: 'DAILY', label: 'day' },
  { value: 'WEEKLY', label: 'week' },
  { value: 'MONTHLY', label: 'month' },
  { value: 'YEARLY', label: 'year' },
];

export interface EventComposerFormProps {
  calendarOptions: EventEditorCalendarOption[];
  guestOptions: Accessor<EventEditorGuestOption[]>;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: EventEditorSubmitValues) => void;
}

/** Create-only event form laid out like the standalone task composer. */
export function EventComposerForm(props: EventComposerFormProps) {
  const formId = createUniqueId();

  const recurrenceEndsName = `event-composer-recurrence-ends-${formId}`;
  const dateRangeErrorId = `event-composer-date-range-error-${formId}`;

  const [state, setState] = createSignal<EventEditorInitialValues>(
    defaultEditorInitialValues(new Date())
  );

  const [selectedGuests, setSelectedGuests] = createSignal<
    SelectedEventEditorGuest[]
  >([]);

  const [recurrenceChoice, setRecurrenceChoice] = createSignal('none');

  const startForRecurrence = createMemo(() => {
    const start = state().start;
    const parsed = state().allDay ? parseISO(start) : new Date(start);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  });

  const presets = createMemo(() => recurrencePresetsFor(startForRecurrence()));

  const recurrenceOptions = createMemo<ComposerSelectOption[]>(() => [
    { value: 'none', label: 'Does not repeat' },
    ...presets().map((preset) => ({
      value: preset.id,
      label: preset.label,
    })),
    { value: 'custom', label: 'Custom' },
  ]);

  const selectedRecurrenceOption = () =>
    recurrenceOptions().find((option) => option.value === recurrenceChoice()) ??
    recurrenceOptions()[0];

  const [customConfig, setCustomConfig] = createSignal<RecurrenceConfig>(
    defaultCustomConfig(startForRecurrence())
  );

  const selectedFrequencyOption = () =>
    REPEAT_FREQUENCY_OPTIONS.find(
      (option) => option.value === customConfig().frequency
    ) ?? REPEAT_FREQUENCY_OPTIONS[0];

  const effectiveCalendarId = () =>
    state().calendarId ?? props.calendarOptions[0]?.id;

  const selectedCalendarOption = () =>
    props.calendarOptions.find(
      (option) => option.id === effectiveCalendarId()
    ) ?? props.calendarOptions[0];

  const changeRecurrenceChoice = (choice: string) => {
    if (choice === 'custom') {
      const seed =
        presets().find((preset) => preset.id === recurrenceChoice())?.config ??
        defaultCustomConfig(startForRecurrence());
      setCustomConfig(seed);
    }
    setRecurrenceChoice(choice);
  };

  const toggleWeekday = (code: WeekdayCode) => {
    setCustomConfig((config) => ({
      ...config,
      byDay: config.byDay.includes(code)
        ? config.byDay.filter((day) => day !== code)
        : [...config.byDay, code],
    }));
  };

  const setEnds = (ends: RecurrenceConfig['ends']) =>
    setCustomConfig((config) => ({ ...config, ends }));

  const customValid = createMemo(() => {
    if (recurrenceChoice() !== 'custom') return true;
    const config = customConfig();
    if (!Number.isInteger(config.interval) || config.interval < 1) return false;
    if (config.frequency === 'WEEKLY' && config.byDay.length === 0) {
      return false;
    }
    if (config.ends.kind === 'on') return config.ends.date !== '';
    if (config.ends.kind === 'after') {
      return Number.isInteger(config.ends.count) && config.ends.count >= 1;
    }
    return true;
  });

  const recurrenceLines = () => {
    const choice = recurrenceChoice();
    if (choice === 'none') return [];
    if (choice === 'custom') {
      return buildRecurrenceLines(customConfig(), state().allDay);
    }
    const preset = presets().find((candidate) => candidate.id === choice);
    return preset
      ? buildRecurrenceLines(preset.config, state().allDay)
      : undefined;
  };

  const dateRangeError = createMemo(() => {
    const current = state();
    if (!current.start || !current.end) return undefined;
    if (current.allDay) {
      return current.end < current.start
        ? 'End date cannot be before the start date.'
        : undefined;
    }
    const start = new Date(current.start);
    const end = new Date(current.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return undefined;
    }
    return end <= start ? 'End time must be after the start time.' : undefined;
  });

  const eventTime = createMemo(() => buildEventTime(state()));
  const canCreate = () => eventTime() !== undefined && customValid();

  const submit = () => {
    const time = eventTime();
    if (!time || !canCreate() || props.pending) return;
    const current = state();
    props.onSubmit({
      title: current.title,
      time,
      recurrenceLines: recurrenceLines(),
      calendarId: effectiveCalendarId(),
      guestEmails: selectedGuests().map(guestEmail),
      location: current.location,
      description: current.description,
    });
  };

  const DateTimeRange = () => (
    <div class="flex min-w-0 flex-col gap-1">
      <div class="flex min-w-0 items-center gap-1">
        <div class="inline-flex min-w-0 max-w-full items-center gap-1">
          <EventDateTimePill
            endpoint="start"
            value={state().start}
            allDay={state().allDay}
            onChange={(start) =>
              setState(
                state().allDay
                  ? moveAllDayRange(state(), start)
                  : { ...state(), start }
              )
            }
            disabled={props.pending}
            invalid={dateRangeError() !== undefined}
            describedBy={dateRangeError() ? dateRangeErrorId : undefined}
          />
          <span
            aria-label="to"
            class="flex h-7 shrink-0 items-center px-0.5 text-ink-extra-muted"
          >
            <ArrowRightIcon aria-hidden="true" class="size-3" />
          </span>
          <EventDateTimePill
            endpoint="end"
            value={state().end}
            allDay={state().allDay}
            onChange={(end) => setState({ ...state(), end })}
            disabled={props.pending}
            invalid={dateRangeError() !== undefined}
            describedBy={dateRangeError() ? dateRangeErrorId : undefined}
          />
        </div>
        <Checkbox
          checked={state().allDay}
          disabled={props.pending}
          onChange={(allDay) =>
            setState(convertTimesForAllDay(state(), allDay))
          }
          class="ml-auto shrink-0 pl-3 text-xs text-ink-muted"
        >
          <Checkbox.Control />
          <Checkbox.Label>All day</Checkbox.Label>
        </Checkbox>
      </div>
      <Show when={dateRangeError()}>
        {(error) => (
          <p id={dateRangeErrorId} role="alert" class="text-xs text-failure">
            {error()}
          </p>
        )}
      </Show>
    </div>
  );

  return (
    <form
      class="flex min-h-0 flex-1 flex-col gap-4 text-sm text-ink-muted [&_:disabled]:cursor-not-allowed"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div class="min-h-0 flex-1 overflow-y-auto scrollbar-hidden">
        <div class="mb-4 px-2">
          <input
            type="text"
            value={state().title}
            onInput={(event) =>
              setState({ ...state(), title: event.currentTarget.value })
            }
            placeholder="New event"
            aria-label="Title"
            autofocus
            disabled={props.pending}
            class="h-9 w-full bg-transparent text-lg font-semibold leading-snug text-ink outline-none placeholder:text-ink-placeholder"
          />
        </div>

        <div class="flex flex-col gap-4 px-2">
          <DateTimeRange />

          <textarea
            value={state().description}
            onInput={(event) =>
              setState({ ...state(), description: event.currentTarget.value })
            }
            placeholder="Add description..."
            aria-label="Description"
            rows={5}
            disabled={props.pending}
            class="min-h-24 w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
          />
        </div>

        <div class="mt-6 flex min-h-7 flex-row flex-wrap items-center gap-2 text-sm m-px">
          <EventComposerGuestsPill
            options={props.guestOptions}
            selected={selectedGuests()}
            onChange={setSelectedGuests}
            disabled={props.pending}
          />
          <EventComposerLocationPill
            value={state().location}
            onChange={(location) => setState({ ...state(), location })}
            disabled={props.pending}
          />
          <EventComposerRecurrencePill
            options={recurrenceOptions()}
            value={selectedRecurrenceOption()}
            onChange={changeRecurrenceChoice}
            disabled={props.pending}
          />
          <Show when={props.calendarOptions.length > 1}>
            <EventComposerCalendarPill
              options={props.calendarOptions}
              value={selectedCalendarOption()}
              onChange={(calendarId) => setState({ ...state(), calendarId })}
              disabled={props.pending}
            />
          </Show>
        </div>
        <Show when={recurrenceChoice() === 'custom'}>
          <div class="mt-3 flex flex-col gap-2.5 rounded-lg border border-edge-muted p-3 text-xs text-ink-muted">
            <div class="flex flex-wrap items-center gap-2">
              <span>Repeat every</span>
              <input
                type="number"
                min="1"
                value={customConfig().interval}
                onInput={(event) =>
                  setCustomConfig((config) => ({
                    ...config,
                    interval: event.currentTarget.valueAsNumber,
                  }))
                }
                aria-label="Repeat interval"
                class="settings-input h-7 w-16"
                disabled={props.pending}
              />
              <Select<ComposerSelectOption<RecurrenceConfig['frequency']>>
                options={REPEAT_FREQUENCY_OPTIONS}
                value={selectedFrequencyOption()}
                onChange={(option) =>
                  option &&
                  setCustomConfig((config) => ({
                    ...config,
                    frequency: option.value,
                  }))
                }
                optionValue="value"
                optionTextValue="label"
                disabled={props.pending}
              >
                <Select.Trigger
                  aria-label="Repeat unit"
                  class="settings-input h-7 w-28"
                >
                  <Select.Value<
                    ComposerSelectOption<RecurrenceConfig['frequency']>
                  >>
                    {(selectState) => selectState.selectedOption().label}
                  </Select.Value>
                  <Select.Icon />
                </Select.Trigger>
                <Select.Content>
                  <Select.Listbox />
                </Select.Content>
              </Select>
            </div>

            <Show when={customConfig().frequency === 'WEEKLY'}>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="mr-1">Repeat on</span>
                <For each={WEEKDAY_CODES}>
                  {(code) => (
                    <Button
                      type="button"
                      variant={
                        customConfig().byDay.includes(code) ? 'active' : 'ghost'
                      }
                      size="icon-sm"
                      class="rounded-full text-xxs"
                      aria-label={code}
                      aria-pressed={customConfig().byDay.includes(code)}
                      disabled={props.pending}
                      onClick={() => toggleWeekday(code)}
                    >
                      {code[0]}
                    </Button>
                  )}
                </For>
              </div>
            </Show>

            <div class="flex flex-col gap-1.5">
              <span>Ends</span>
              <label class="flex items-center gap-2">
                <input
                  type="radio"
                  name={recurrenceEndsName}
                  checked={customConfig().ends.kind === 'never'}
                  onChange={() => setEnds({ kind: 'never' })}
                  disabled={props.pending}
                />
                Never
              </label>
              <label class="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name={recurrenceEndsName}
                  checked={customConfig().ends.kind === 'on'}
                  onChange={() =>
                    setEnds({
                      kind: 'on',
                      date: format(
                        addMonths(startForRecurrence(), 3),
                        DATE_VALUE
                      ),
                    })
                  }
                  disabled={props.pending}
                />
                On
                <Show when={customConfig().ends.kind === 'on'}>
                  <input
                    type="date"
                    value={
                      customConfig().ends.kind === 'on'
                        ? customConfig().ends.date
                        : ''
                    }
                    onInput={(event) =>
                      setEnds({
                        kind: 'on',
                        date: event.currentTarget.value,
                      })
                    }
                    aria-label="Ends on date"
                    class="settings-input h-7"
                    disabled={props.pending}
                  />
                </Show>
              </label>
              <label class="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name={recurrenceEndsName}
                  checked={customConfig().ends.kind === 'after'}
                  onChange={() => setEnds({ kind: 'after', count: 13 })}
                  disabled={props.pending}
                />
                After
                <Show when={customConfig().ends.kind === 'after'}>
                  <input
                    type="number"
                    min="1"
                    value={
                      customConfig().ends.kind === 'after'
                        ? customConfig().ends.count
                        : 13
                    }
                    onInput={(event) =>
                      setEnds({
                        kind: 'after',
                        count: event.currentTarget.valueAsNumber,
                      })
                    }
                    aria-label="Ends after occurrences"
                    class="settings-input h-7 w-20"
                    disabled={props.pending}
                  />
                  occurrences
                </Show>
              </label>
            </div>
          </div>
        </Show>
      </div>

      <div class="flex shrink-0 items-center justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          class="rounded-lg"
          disabled={props.pending}
          label="Cancel"
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant={canCreate() ? 'active' : 'ghost'}
          depth={3}
          class="rounded-lg border-0"
          disabled={!canCreate() || props.pending}
          label="Create event"
        >
          <Show when={props.pending} fallback="Create event">
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
      </div>
    </form>
  );
}
