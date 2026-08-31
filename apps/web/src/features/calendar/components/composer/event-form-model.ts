import {
  type CombinedRecipientItem,
  recipientEntityMapper,
  type WithCustomUserInput,
} from '@core/user/combinedRecipient';
import { TZDateMini } from '@date-fns/tz';
import type { ConferenceChange } from '@service-email/generated/schemas/conferenceChange';
import type { EventTime } from '@service-email/generated/schemas/eventTime';
import type { EventReminderOverride } from '@service-storage/generated/schemas/eventReminderOverride';
import type { EventReminders } from '@service-storage/generated/schemas/eventReminders';
import type { EventType } from '@service-storage/generated/schemas/eventType';
import {
  addDays,
  addHours,
  differenceInCalendarDays,
  endOfDay,
  format,
  parseISO,
  startOfHour,
} from 'date-fns';
import { type Accessor, batch, createMemo, createSignal } from 'solid-js';
import type { CalendarEvent } from '../../types';
import { parseLocalDate } from '../../utils/calendar-date';
import {
  buildRecurrenceLines,
  defaultCustomConfig,
  formatRecurrenceDescription,
  parseRecurrenceConfig,
  type RecurrenceConfig,
  recurrenceConfigsEqual,
  recurrencePresetsFor,
} from '../../utils/recurrence';

/** `<input type="date">` value. */
const DATE_VALUE = 'yyyy-MM-dd';
/** `<input type="datetime-local">` value. */
const DATETIME_VALUE = "yyyy-MM-dd'T'HH:mm";

const isDateOnly = (value: string) => parseLocalDate(value) !== undefined;

/** Option displayed by an event editor recurrence selector. */
export interface EventEditorRecurrenceOption {
  value: string;
  label: string;
}

function shiftDateValue(value: string, days: number) {
  return format(addDays(parseISO(value), days), DATE_VALUE);
}

/** Default editor slot: the next full hour, one hour long. */
function defaultEditorTimes(reference: Date) {
  const start = addHours(startOfHour(reference), 1);
  return { start, end: addHours(start, 1) };
}

/** Conferencing displayed by the editor before it is submitted. */
export type EventEditorConferenceChoice = 'none' | 'google_meet' | 'existing';

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
  /** What conferencing the saved event should carry. */
  conference: EventEditorConferenceChoice;
  /** Per-user reminder configuration; absent means the calendar default. */
  reminders?: EventReminders;
  /** Provider event type of the edited event; absent for new events. */
  eventType?: EventType;
}

/** Calendar option displayed by the event editor. */
export interface EventEditorCalendarOption {
  id: string;
  label: string;
  color: string;
  /** Provider defaults shown until the event's reminders are customized. */
  defaultReminders?: EventReminderOverride[];
}

/** Editable fields that a create/edit owner may disable. */
type EventEditorField =
  | 'title'
  | 'allDay'
  | 'start'
  | 'end'
  | 'recurrence'
  | 'calendar'
  | 'guests'
  | 'location'
  | 'description'
  | 'conference'
  | 'reminders';

/** Field-level disabled state supplied by a create/edit owner. */
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
  /** Present only when conferencing should be attached, replaced, or removed. */
  conference?: ConferenceChange;
  /** Present only when the user changed the event's reminder configuration. */
  reminders?: EventReminders;
}

export function defaultEditorInitialValues(
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
    conference: 'none',
    reminders: undefined,
    eventType: undefined,
  };
}

/** Converts a FullCalendar-style selected range into create-event values. */
export function calendarSelectionToEditorInitialValues(selection: {
  start: Date;
  end: Date;
  allDay: boolean;
}): EventEditorInitialValues {
  const initialValues = defaultEditorInitialValues(selection.start);
  if (selection.allDay) {
    return {
      ...initialValues,
      allDay: true,
      start: format(selection.start, DATE_VALUE),
      end: format(addDays(selection.end, -1), DATE_VALUE),
    };
  }

  return {
    ...initialValues,
    start: format(selection.start, DATETIME_VALUE),
    end: format(selection.end, DATETIME_VALUE),
  };
}

function initialConferenceChoice(
  event: CalendarEvent
): EventEditorConferenceChoice {
  if (!event.conferenceUrl) return 'none';
  return event.conferenceProvider === 'google_meet'
    ? 'google_meet'
    : 'existing';
}

/** Converts an existing event into values for the shared editor. */
export function calendarEventToEditorInitialValues(
  event: CalendarEvent
): EventEditorInitialValues {
  const guests = event.attendees
    .filter((attendee) => attendee.isOrganizer || !attendee.isSelf)
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
      calendarId: event.calendarId ?? event.calendar.id,
      guests,
      location: event.location ?? '',
      description: event.description ?? '',
      conference: initialConferenceChoice(event),
      reminders: event.reminders,
      eventType: event.eventType,
    };
  }

  return {
    title: event.title,
    allDay: false,
    start: format(new Date(event.start), DATETIME_VALUE),
    end: format(new Date(event.end), DATETIME_VALUE),
    recurrenceLines: [...event.recurrenceLines],
    calendarId: event.calendarId ?? event.calendar.id,
    guests,
    location: event.location ?? '',
    description: event.description ?? '',
    conference: initialConferenceChoice(event),
    reminders: event.reminders,
    eventType: event.eventType,
  };
}

export function buildEventTime(
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

/** Copy shown when guests would be invited to an event that already ended. */
export const PAST_EVENT_GUESTS_WARNING =
  'This event has already ended — guests will still be invited.';

/** When the edited range ends, or `undefined` while the range does not parse. */
export function eventEndsAt(state: EventEditorInitialValues): Date | undefined {
  if (state.allDay) {
    const end = parseLocalDate(state.end);
    return end ? endOfDay(end) : undefined;
  }
  const end = new Date(state.end);
  return Number.isNaN(end.getTime()) ? undefined : end;
}

/** Whether the edited range finished before `now`. In-progress events do not. */
export function eventHasEnded(
  state: EventEditorInitialValues,
  now = new Date()
) {
  const endsAt = eventEndsAt(state);
  return endsAt !== undefined && endsAt.getTime() < now.getTime();
}

function parseGuestEmails(value: string) {
  return [...new Set(value.split(/[\s,;]+/).filter((email) => email !== ''))];
}

type EventEditorGuestKind = 'user' | 'contact';
export type EventEditorGuestOption =
  CombinedRecipientItem<EventEditorGuestKind>;
export type SelectedEventEditorGuest =
  WithCustomUserInput<EventEditorGuestKind>;

export function guestEmail(option: SelectedEventEditorGuest) {
  return option.data.email;
}

export function initialGuestOptions(
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
export function convertTimesForAllDay(
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

export function moveAllDayRange(
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

export interface CreateEventEditorStateOptions {
  initialValues: EventEditorInitialValues;
  state: Accessor<EventEditorInitialValues>;
  recurrenceTimeZone?: string;
}

function recurrenceConfigFor(
  values: EventEditorInitialValues,
  timeZone?: string
) {
  return values.recurrenceLines.length > 0
    ? parseRecurrenceConfig(values.recurrenceLines, timeZone)
    : undefined;
}

function recurrenceChoiceFor(
  values: EventEditorInitialValues,
  timeZone?: string
) {
  if (values.recurrenceLines.length === 0) return 'none';
  const config = recurrenceConfigFor(values, timeZone);
  if (!config) return 'existing';
  const start = values.allDay ? parseISO(values.start) : new Date(values.start);
  const preset = recurrencePresetsFor(start).find((candidate) =>
    recurrenceConfigsEqual(candidate.config, config)
  );
  return preset?.id ?? 'custom';
}

/** Shared recurrence and validation state used by event editor layouts. */
export function createEventEditorState(options: CreateEventEditorStateOptions) {
  const [initialValues, setInitialValues] = createSignal(options.initialValues);
  const initialConfig = createMemo(() =>
    recurrenceConfigFor(initialValues(), options.recurrenceTimeZone)
  );
  const hasUnrepresentableRule = () =>
    initialValues().recurrenceLines.length > 0 && !initialConfig();

  const startForRecurrence = createMemo(() => {
    const state = options.state();
    const parsed = state.allDay ? parseISO(state.start) : new Date(state.start);
    if (Number.isNaN(parsed.getTime())) return new Date();
    return !state.allDay && options.recurrenceTimeZone
      ? TZDateMini.tz(options.recurrenceTimeZone, parsed)
      : parsed;
  });
  const presets = createMemo(() => recurrencePresetsFor(startForRecurrence()));
  const [recurrenceChoice, setRecurrenceChoice] = createSignal(
    recurrenceChoiceFor(options.initialValues, options.recurrenceTimeZone)
  );
  const recurrenceOptions = createMemo<EventEditorRecurrenceOption[]>(() => {
    const values = [
      { value: 'none', label: 'Does not repeat' },
      ...presets().map((preset) => ({
        value: preset.id,
        label: preset.label,
      })),
    ];
    if (hasUnrepresentableRule()) {
      values.push({
        value: 'existing',
        label: `Custom: ${
          formatRecurrenceDescription(initialValues().recurrenceLines) ??
          'existing rule'
        } (unchanged)`,
      });
    }
    values.push({ value: 'custom', label: 'Custom' });
    return values;
  });
  const selectedRecurrenceOption = () =>
    recurrenceOptions().find((option) => option.value === recurrenceChoice()) ??
    recurrenceOptions()[0];
  const [customConfig, setCustomConfig] = createSignal<RecurrenceConfig>(
    initialConfig() ?? defaultCustomConfig(startForRecurrence())
  );
  const changeRecurrenceChoice = (choice: string) => {
    if (choice === 'custom') {
      const seed =
        presets().find((preset) => preset.id === recurrenceChoice())?.config ??
        initialConfig() ??
        defaultCustomConfig(startForRecurrence());
      setCustomConfig(seed);
    }
    setRecurrenceChoice(choice);
  };
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
  const recurrenceLines = (): string[] | undefined => {
    const choice = recurrenceChoice();
    if (choice === 'existing') return undefined;
    if (choice === 'none') return [];
    if (choice === 'custom') {
      return buildRecurrenceLines(
        customConfig(),
        options.state().allDay,
        options.recurrenceTimeZone
      );
    }
    const preset = presets().find((candidate) => candidate.id === choice);
    return preset
      ? buildRecurrenceLines(
          preset.config,
          options.state().allDay,
          options.recurrenceTimeZone
        )
      : undefined;
  };
  const dateRangeError = createMemo(() => {
    const current = options.state();
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
  const eventTime = createMemo(() => buildEventTime(options.state()));
  const canSave = () =>
    options.state().title.trim() !== '' &&
    eventTime() !== undefined &&
    customValid();
  const replaceInitialValues = (next: EventEditorInitialValues) => {
    batch(() => {
      setInitialValues(() => next);
      setRecurrenceChoice(
        recurrenceChoiceFor(next, options.recurrenceTimeZone)
      );
      setCustomConfig(
        recurrenceConfigFor(next, options.recurrenceTimeZone) ??
          defaultCustomConfig(startForRecurrence())
      );
    });
  };

  return {
    startForRecurrence,
    recurrenceChoice,
    recurrenceOptions,
    selectedRecurrenceOption,
    customConfig,
    setCustomConfig,
    changeRecurrenceChoice,
    recurrenceLines,
    dateRangeError,
    eventTime,
    canSave,
    replaceInitialValues,
  };
}
