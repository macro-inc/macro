import { RecipientSelector } from '@core/component/RecipientSelector';
import {
  type CombinedRecipientItem,
  recipientEntityMapper,
  type WithCustomUserInput,
} from '@core/user/combinedRecipient';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CalendarDotsIcon from '@phosphor/calendar-dots.svg';
import MapPinIcon from '@phosphor/map-pin.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import TextAlignLeftIcon from '@phosphor/text-align-left.svg';
import UsersIcon from '@phosphor/users.svg';
import type { EventTime } from '@service-email/generated/schemas/eventTime';
import { Button, cn, Select, ToggleSwitch } from '@ui';
import {
  addDays,
  addHours,
  addMonths,
  differenceInCalendarDays,
  format,
  isMatch,
  parseISO,
  startOfHour,
} from 'date-fns';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Show,
} from 'solid-js';
import { formatRecurrenceDescription } from './recurrence-description';
import {
  buildRecurrenceLines,
  defaultCustomConfig,
  parseRecurrenceConfig,
  type RecurrenceConfig,
  recurrenceConfigsEqual,
  recurrencePresetsFor,
  WEEKDAY_CODES,
  type WeekdayCode,
} from './recurrence-editor';
import type { CalendarEvent } from './types';

/** `<input type="date">` value. */
const DATE_VALUE = 'yyyy-MM-dd';
/** `<input type="datetime-local">` value. */
const DATETIME_VALUE = "yyyy-MM-dd'T'HH:mm";

const EDITOR_INPUT_CLASS =
  'rounded-none! border-x-0! border-t-0! border-b! px-0!';

const isDateOnly = (value: string) => isMatch(value, DATE_VALUE);

type EditorSelectOption<Value extends string = string> = {
  value: Value;
  label: string;
};

const REPEAT_FREQUENCY_OPTIONS: EditorSelectOption<
  RecurrenceConfig['frequency']
>[] = [
  { value: 'DAILY', label: 'day' },
  { value: 'WEEKLY', label: 'week' },
  { value: 'MONTHLY', label: 'month' },
  { value: 'YEARLY', label: 'year' },
];

function shiftDateValue(value: string, days: number) {
  return format(addDays(parseISO(value), days), DATE_VALUE);
}

/** Default editor slot: the next full hour, one hour long. */
function defaultEditorTimes(reference: Date) {
  const start = addHours(startOfHour(reference), 1);
  return { start, end: addHours(start, 1) };
}

/** Values used to initialize the shared event editor form. */
export interface EventEditorInitialValues {
  title: string;
  allDay: boolean;
  /** `datetime-local` value, or `date` value in all-day mode. */
  start: string;
  /** Inclusive end shown to the user; all-day submissions add the exclusive day. */
  end: string;
  recurrenceLines: string[];
  calendarId?: string;
  guests: string;
  location: string;
  description: string;
}

/** Calendar option displayed by the event editor. */
export interface EventEditorCalendarOption {
  id: string;
  label: string;
}

/** Editable fields that a create/edit owner may disable. */
export type EventEditorField =
  | 'title'
  | 'allDay'
  | 'start'
  | 'end'
  | 'recurrence'
  | 'calendar'
  | 'guests'
  | 'location'
  | 'description';

/** Field-level disabled state supplied by the create/edit owner. */
export type EventEditorDisabledFields = Partial<
  Record<EventEditorField, boolean>
>;

/** Validated values emitted by the shared event editor form. */
export interface EventEditorSubmitValues {
  title: string;
  time: EventTime;
  recurrenceLines?: string[];
  calendarId?: string;
  guestEmails: string[];
  location: string;
  description: string;
}

function defaultEditorInitialValues(
  reference = new Date()
): EventEditorInitialValues {
  const { start, end } = defaultEditorTimes(reference);
  return {
    title: '',
    allDay: false,
    start: format(start, DATETIME_VALUE),
    end: format(end, DATETIME_VALUE),
    recurrenceLines: [],
    calendarId: undefined,
    guests: '',
    location: '',
    description: '',
  };
}

/** Converts an existing event into values for the shared editor. */
export function calendarEventToEditorInitialValues(
  event: CalendarEvent
): EventEditorInitialValues {
  const guests = event.attendees
    .filter((attendee) => !attendee.isSelf && !attendee.isOrganizer)
    .map((attendee) => attendee.email)
    .join(', ');

  if (event.allDay) {
    const start = isDateOnly(event.start)
      ? event.start
      : format(new Date(event.start), DATE_VALUE);
    const exclusiveEnd = isDateOnly(event.end)
      ? event.end
      : format(new Date(event.end), DATE_VALUE);
    return {
      title: event.title,
      allDay: true,
      start,
      end: shiftDateValue(exclusiveEnd, -1),
      recurrenceLines: [...event.recurrenceLines],
      calendarId: event.calendar.id,
      guests,
      location: event.location ?? '',
      description: event.description ?? '',
    };
  }

  return {
    title: event.title,
    allDay: false,
    start: format(new Date(event.start), DATETIME_VALUE),
    end: format(new Date(event.end), DATETIME_VALUE),
    recurrenceLines: [...event.recurrenceLines],
    calendarId: event.calendar.id,
    guests,
    location: event.location ?? '',
    description: event.description ?? '',
  };
}

function buildEventTime(
  state: EventEditorInitialValues
): EventTime | undefined {
  if (state.allDay) {
    if (!state.start || !state.end || state.end < state.start) {
      return undefined;
    }
    return {
      kind: 'allDay',
      startDate: state.start,
      endDate: shiftDateValue(state.end, 1),
    };
  }

  const start = new Date(state.start);
  const end = new Date(state.end);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return undefined;
  }
  return {
    kind: 'timed',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function parseGuestEmails(value: string) {
  return [...new Set(value.split(/[\s,;]+/).filter((email) => email !== ''))];
}

type EventEditorGuestKind = 'user' | 'contact';
export type EventEditorGuestOption =
  CombinedRecipientItem<EventEditorGuestKind>;
type SelectedEventEditorGuest = WithCustomUserInput<EventEditorGuestKind>;

function guestEmail(option: SelectedEventEditorGuest) {
  return option.data.email;
}

function initialGuestOptions(
  value: string,
  options: EventEditorGuestOption[]
): SelectedEventEditorGuest[] {
  return parseGuestEmails(value).map((email) => {
    const existing = options.find(
      (option) => guestEmail(option).toLowerCase() === email.toLowerCase()
    );
    return (
      existing ??
      recipientEntityMapper('custom')({
        id: `macro|${email}`,
        email,
        invalid: false,
      })
    );
  });
}

/** Both editor times switch representation when all-day toggles. */
function convertTimesForAllDay(
  state: EventEditorInitialValues,
  allDay: boolean
) {
  if (allDay === state.allDay) return state;
  if (allDay) {
    return {
      ...state,
      allDay,
      start: state.start.slice(0, 10),
      end: state.end.slice(0, 10),
    };
  }
  const { start, end } = defaultEditorTimes(parseISO(state.start));
  return {
    ...state,
    allDay,
    start: format(start, DATETIME_VALUE),
    end: format(end, DATETIME_VALUE),
  };
}

function moveAllDayRange(
  state: EventEditorInitialValues,
  nextStart: string
): EventEditorInitialValues {
  if (nextStart === '') return { ...state, start: '', end: '' };
  const duration = differenceInCalendarDays(
    parseISO(state.end),
    parseISO(state.start)
  );
  const durationDays = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  return {
    ...state,
    start: nextStart,
    end: shiftDateValue(nextStart, durationDays),
  };
}

export interface EventEditorFormProps {
  initialValues?: EventEditorInitialValues;
  disabledFields?: EventEditorDisabledFields;
  calendarOptions: EventEditorCalendarOption[];
  guestOptions: Accessor<EventEditorGuestOption[]>;
  showRecurringEditNotice?: boolean;
  pending: boolean;
  class?: string;
  onCancel: () => void;
  onSubmit: (values: EventEditorSubmitValues) => void;
}

/** Shared create/edit event form, independent of its dialog or drawer shell. */
export function EventEditorForm(props: EventEditorFormProps) {
  const formId = createUniqueId();
  const recurrenceEndsName = `recurrence-ends-${formId}`;
  const guestInputId = `event-guests-${formId}`;

  const initialValues =
    props.initialValues ?? defaultEditorInitialValues(new Date());

  const initialLines = [...initialValues.recurrenceLines];

  const [state, setState] = createSignal<EventEditorInitialValues>({
    ...initialValues,
    recurrenceLines: [...initialLines],
  });

  const [selectedGuests, setSelectedGuests] = createSignal<
    SelectedEventEditorGuest[]
  >(initialGuestOptions(initialValues.guests, props.guestOptions()));

  const fieldIsDisabled = (field: EventEditorField) =>
    props.disabledFields?.[field] === true;

  const inputIsDisabled = (field: EventEditorField) =>
    props.pending || fieldIsDisabled(field);

  const effectiveCalendarId = () =>
    state().calendarId ?? props.calendarOptions[0]?.id;

  const initialConfig =
    initialLines.length > 0 ? parseRecurrenceConfig(initialLines) : undefined;

  const hasUnrepresentableRule = initialLines.length > 0 && !initialConfig;

  const startForRecurrence = createMemo(() => {
    const start = state().start;
    const parsed = state().allDay ? parseISO(start) : new Date(start);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  });

  const presets = createMemo(() => recurrencePresetsFor(startForRecurrence()));

  const initialChoice = () => {
    if (initialLines.length === 0) return 'none';
    if (!initialConfig) return 'existing';
    const initialStart = initialValues.allDay
      ? parseISO(initialValues.start)
      : new Date(initialValues.start);
    const preset = recurrencePresetsFor(initialStart).find((candidate) =>
      recurrenceConfigsEqual(candidate.config, initialConfig)
    );
    return preset?.id ?? 'custom';
  };

  const [recurrenceChoice, setRecurrenceChoice] = createSignal(initialChoice());

  const recurrenceOptions = createMemo<EditorSelectOption[]>(() => {
    const options = [
      { value: 'none', label: 'Does not repeat' },
      ...presets().map((preset) => ({
        value: preset.id,
        label: preset.label,
      })),
    ];
    if (hasUnrepresentableRule) {
      options.push({
        value: 'existing',
        label: `Custom: ${
          formatRecurrenceDescription(initialLines) ?? 'existing rule'
        } (unchanged)`,
      });
    }
    options.push({ value: 'custom', label: 'Custom…' });
    return options;
  });

  const selectedRecurrenceOption = () =>
    recurrenceOptions().find((option) => option.value === recurrenceChoice()) ??
    recurrenceOptions()[0];

  const [customConfig, setCustomConfig] = createSignal<RecurrenceConfig>(
    initialConfig ?? defaultCustomConfig(startForRecurrence())
  );

  const changeRecurrenceChoice = (choice: string) => {
    if (choice === 'custom') {
      const seed =
        presets().find((preset) => preset.id === recurrenceChoice())?.config ??
        initialConfig ??
        defaultCustomConfig(startForRecurrence());
      setCustomConfig(seed);
    }
    setRecurrenceChoice(choice);
  };

  const selectedFrequencyOption = () =>
    REPEAT_FREQUENCY_OPTIONS.find(
      (option) => option.value === customConfig().frequency
    ) ?? REPEAT_FREQUENCY_OPTIONS[0];

  const selectedCalendarOption = () =>
    props.calendarOptions.find(
      (option) => option.id === effectiveCalendarId()
    ) ?? props.calendarOptions[0];

  const customValid = createMemo(() => {
    if (recurrenceChoice() !== 'custom') return true;

    const config = customConfig();

    if (!Number.isInteger(config.interval) || config.interval < 1) {
      return false;
    }

    if (config.frequency === 'WEEKLY' && config.byDay.length === 0) {
      return false;
    }

    if (config.ends.kind === 'on') return config.ends.date !== '';

    if (config.ends.kind === 'after') {
      return Number.isInteger(config.ends.count) && config.ends.count >= 1;
    }

    return true;
  });

  /** `undefined` leaves an unrepresentable stored rule untouched. */
  const recurrenceLines = (): string[] | undefined => {
    const choice = recurrenceChoice();
    if (choice === 'existing') return undefined;

    if (choice === 'none') return [];

    if (choice === 'custom') {
      return buildRecurrenceLines(customConfig(), state().allDay);
    }

    const preset = presets().find((candidate) => candidate.id === choice);

    return preset
      ? buildRecurrenceLines(preset.config, state().allDay)
      : undefined;
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

  const eventTime = createMemo(() => buildEventTime(state()));
  const canSave = () => eventTime() !== undefined && customValid();

  const submit = () => {
    const time = eventTime();
    if (!time || !canSave() || props.pending) return;
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

  return (
    <form
      class={cn(
        'grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-4 gap-y-5 p-3 sm:grid-cols-[1rem_minmax(0,1fr)] sm:gap-x-3 sm:gap-y-3',
        props.class
      )}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <CalendarBlankIcon
        aria-hidden="true"
        class="mt-2 size-5 text-ink-extra-muted sm:size-4"
      />

      <div class="flex min-w-0 flex-col gap-3">
        <input
          type="text"
          value={state().title}
          onInput={(event) =>
            setState({ ...state(), title: event.currentTarget.value })
          }
          placeholder="Add title"
          aria-label="Title"
          class={cn('settings-input w-full', EDITOR_INPUT_CLASS)}
          disabled={inputIsDisabled('title')}
        />

        <div class="flex items-center justify-between gap-2 text-xs text-ink-muted">
          <ToggleSwitch
            label="All day"
            checked={state().allDay}
            disabled={inputIsDisabled('allDay')}
            onChange={(allDay) =>
              setState(convertTimesForAllDay(state(), allDay))
            }
          />
          <Show
            when={state().allDay}
            fallback={
              <Show when={props.showRecurringEditNotice}>
                <span class="text-ink-extra-muted">
                  Changes apply to all occurrences
                </span>
              </Show>
            }
          >
            <input
              type="date"
              value={state().start}
              onInput={(event) =>
                setState(moveAllDayRange(state(), event.currentTarget.value))
              }
              aria-label="Date"
              class={cn(
                'settings-input min-w-0 w-40 max-w-full',
                EDITOR_INPUT_CLASS
              )}
              disabled={inputIsDisabled('start') || inputIsDisabled('end')}
            />
          </Show>
        </div>

        <Show when={state().allDay && props.showRecurringEditNotice}>
          <span class="text-right text-xs text-ink-extra-muted">
            Changes apply to all occurrences
          </span>
        </Show>

        <Show when={!state().allDay}>
          <div class="flex items-center gap-2">
            <input
              type="datetime-local"
              value={state().start}
              onInput={(event) =>
                setState({ ...state(), start: event.currentTarget.value })
              }
              aria-label="Start"
              class={cn('settings-input min-w-0 flex-1', EDITOR_INPUT_CLASS)}
              disabled={inputIsDisabled('start')}
            />
            <span class="shrink-0 text-xs text-ink-extra-muted">to</span>
            <input
              type="datetime-local"
              value={state().end}
              onInput={(event) =>
                setState({ ...state(), end: event.currentTarget.value })
              }
              aria-label="End"
              class={cn('settings-input min-w-0 flex-1', EDITOR_INPUT_CLASS)}
              disabled={inputIsDisabled('end')}
            />
          </div>
        </Show>

        <div class="flex flex-col gap-2">
          <Select<EditorSelectOption>
            options={recurrenceOptions()}
            value={selectedRecurrenceOption()}
            onChange={(option) =>
              option && changeRecurrenceChoice(option.value)
            }
            optionValue="value"
            optionTextValue="label"
            disabled={inputIsDisabled('recurrence')}
          >
            <Select.Trigger aria-label="Repeats" class={EDITOR_INPUT_CLASS}>
              <Select.Value<EditorSelectOption>>
                {(selectState) => selectState.selectedOption().label}
              </Select.Value>
              <Select.Icon />
            </Select.Trigger>
            <Select.Content portalScope="local">
              <Select.Listbox />
            </Select.Content>
          </Select>

          <Show when={recurrenceChoice() === 'custom'}>
            <div class="border-edge-muted flex flex-col gap-2.5 rounded-lg border p-2.5 text-xs text-ink-muted">
              <div class="flex items-center gap-2">
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
                  class={cn('settings-input w-16', EDITOR_INPUT_CLASS)}
                  disabled={inputIsDisabled('recurrence')}
                />
                <Select<EditorSelectOption<RecurrenceConfig['frequency']>>
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
                  disabled={inputIsDisabled('recurrence')}
                >
                  <Select.Trigger
                    aria-label="Repeat unit"
                    class={cn('w-28', EDITOR_INPUT_CLASS)}
                  >
                    <Select.Value<
                      EditorSelectOption<RecurrenceConfig['frequency']>
                    >>
                      {(selectState) => selectState.selectedOption().label}
                    </Select.Value>
                    <Select.Icon />
                  </Select.Trigger>
                  <Select.Content portalScope="local">
                    <Select.Listbox />
                  </Select.Content>
                </Select>
              </div>

              <Show when={customConfig().frequency === 'WEEKLY'}>
                <div class="flex items-center gap-1.5">
                  <span class="mr-1">Repeat on</span>
                  <For each={WEEKDAY_CODES}>
                    {(code) => (
                      <Button
                        type="button"
                        variant={
                          customConfig().byDay.includes(code)
                            ? 'active'
                            : 'ghost'
                        }
                        size="icon-sm"
                        class="rounded-full text-xxs"
                        aria-label={code}
                        aria-pressed={customConfig().byDay.includes(code)}
                        disabled={inputIsDisabled('recurrence')}
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
                    disabled={inputIsDisabled('recurrence')}
                  />
                  Never
                </label>
                <label class="flex items-center gap-2">
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
                    disabled={inputIsDisabled('recurrence')}
                  />
                  On
                  <Show when={customConfig().ends.kind === 'on'}>
                    <input
                      type="date"
                      value={
                        customConfig().ends.kind === 'on'
                          ? (
                              customConfig().ends as {
                                kind: 'on';
                                date: string;
                              }
                            ).date
                          : ''
                      }
                      onInput={(event) =>
                        setEnds({
                          kind: 'on',
                          date: event.currentTarget.value,
                        })
                      }
                      aria-label="Ends on date"
                      class={cn('settings-input', EDITOR_INPUT_CLASS)}
                      disabled={inputIsDisabled('recurrence')}
                    />
                  </Show>
                </label>
                <label class="flex items-center gap-2">
                  <input
                    type="radio"
                    name={recurrenceEndsName}
                    checked={customConfig().ends.kind === 'after'}
                    onChange={() => setEnds({ kind: 'after', count: 13 })}
                    disabled={inputIsDisabled('recurrence')}
                  />
                  After
                  <Show when={customConfig().ends.kind === 'after'}>
                    <input
                      type="number"
                      min="1"
                      value={
                        customConfig().ends.kind === 'after'
                          ? (
                              customConfig().ends as {
                                kind: 'after';
                                count: number;
                              }
                            ).count
                          : 13
                      }
                      onInput={(event) =>
                        setEnds({
                          kind: 'after',
                          count: event.currentTarget.valueAsNumber,
                        })
                      }
                      aria-label="Ends after occurrences"
                      class={cn('settings-input w-20', EDITOR_INPUT_CLASS)}
                      disabled={inputIsDisabled('recurrence')}
                    />
                    occurrences
                  </Show>
                </label>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <Show
        when={props.calendarOptions.length > 1 || fieldIsDisabled('calendar')}
      >
        <div class="contents">
          <CalendarDotsIcon
            aria-hidden="true"
            class="mt-2 size-5 text-ink-extra-muted sm:size-4"
          />
          <Select<EventEditorCalendarOption>
            options={props.calendarOptions}
            value={selectedCalendarOption()}
            onChange={(option) =>
              option && setState({ ...state(), calendarId: option.id })
            }
            optionValue="id"
            optionTextValue="label"
            disabled={inputIsDisabled('calendar')}
          >
            <Select.Trigger aria-label="Calendar" class={EDITOR_INPUT_CLASS}>
              <Select.Value<EventEditorCalendarOption>>
                {(selectState) => selectState.selectedOption().label}
              </Select.Value>
              <Select.Icon />
            </Select.Trigger>
            <Select.Content portalScope="local">
              <Select.Listbox />
            </Select.Content>
          </Select>
        </div>
      </Show>

      <UsersIcon
        aria-hidden="true"
        class="mt-2 size-5 text-ink-extra-muted sm:size-4"
      />

      <div class="min-w-0">
        <label for={guestInputId} class="sr-only">
          Guests
        </label>
        <RecipientSelector<EventEditorGuestKind>
          inputId={guestInputId}
          options={props.guestOptions}
          selectedOptions={selectedGuests()}
          setSelectedOptions={(next) => {
            if (!inputIsDisabled('guests')) setSelectedGuests(next);
          }}
          placeholder="Add guests"
          hideBorder
          noPadding
          disabled={inputIsDisabled('guests')}
          portalScope="local"
          class={cn(
            'min-h-9 border-edge-muted bg-transparent! py-1 focus-within:border-accent',
            EDITOR_INPUT_CLASS,
            inputIsDisabled('guests') && 'opacity-70'
          )}
        />
      </div>

      <MapPinIcon
        aria-hidden="true"
        class="mt-2 size-5 text-ink-extra-muted sm:size-4"
      />

      <input
        type="text"
        value={state().location}
        onInput={(event) =>
          setState({ ...state(), location: event.currentTarget.value })
        }
        placeholder="Add location"
        aria-label="Location"
        class={cn('settings-input w-full', EDITOR_INPUT_CLASS)}
        disabled={inputIsDisabled('location')}
      />

      <TextAlignLeftIcon
        aria-hidden="true"
        class="mt-2 size-5 text-ink-extra-muted sm:size-4"
      />

      <textarea
        value={state().description}
        onInput={(event) =>
          setState({ ...state(), description: event.currentTarget.value })
        }
        placeholder="Add description"
        aria-label="Description"
        rows={3}
        class={cn(
          'settings-input min-h-20 w-full resize-y py-2',
          EDITOR_INPUT_CLASS
        )}
        disabled={inputIsDisabled('description')}
      />

      <div class="col-start-2 flex justify-end gap-1 pt-1">
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
          variant="cta"
          class="rounded-lg"
          disabled={!canSave() || props.pending}
          label="Save"
        >
          <Show when={props.pending} fallback="Save">
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
      </div>
    </form>
  );
}
