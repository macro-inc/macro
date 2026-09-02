import { type Accessor, batch, createMemo, createSignal } from 'solid-js';
import {
  buildReminderOverrides,
  popupMinutes,
  REMINDER_METHOD_POPUP,
  REMINDER_OVERRIDES_MAX,
  resolveReminderOverrides,
} from '../../utils/event-reminders';
import {
  parseRecurrenceConfig,
  recurrenceConfigsEqual,
} from '../../utils/recurrence';
import {
  convertTimesForAllDay,
  createEventEditorState,
  type EventEditorCalendarOption,
  type EventEditorConferenceChoice,
  type EventEditorGuestOption,
  type EventEditorInitialValues,
  type EventEditorSubmitValues,
  eventHasEnded,
  guestEmail,
  initialGuestOptions,
  moveAllDayRange,
  PAST_EVENT_GUESTS_WARNING,
  type SelectedEventEditorGuest,
} from './event-form-model';

interface EventComposerFormSnapshot {
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  recurrenceLines: readonly string[];
  calendarId?: string;
  guestEmails: readonly string[];
  location: string;
  description: string;
  conference: EventEditorConferenceChoice;
  reminderMinutes: readonly number[];
}

function normalizedGuestEmails(emails: readonly string[]) {
  return emails.map((email) => email.trim().toLowerCase()).sort();
}

function arraysEqual<Value>(first: readonly Value[], second: readonly Value[]) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function recurrenceLinesEqual(
  first: readonly string[],
  second: readonly string[]
) {
  if (arraysEqual(first, second)) return true;

  const firstConfig = parseRecurrenceConfig([...first]);
  const secondConfig = parseRecurrenceConfig([...second]);
  return (
    firstConfig !== undefined &&
    secondConfig !== undefined &&
    recurrenceConfigsEqual(firstConfig, secondConfig)
  );
}

function isEventComposerFormDirty(
  initial: EventComposerFormSnapshot,
  current: EventComposerFormSnapshot
) {
  return (
    initial.title !== current.title ||
    initial.allDay !== current.allDay ||
    initial.start !== current.start ||
    initial.end !== current.end ||
    initial.calendarId !== current.calendarId ||
    initial.location !== current.location ||
    initial.description !== current.description ||
    initial.conference !== current.conference ||
    !arraysEqual(
      normalizedGuestEmails(initial.guestEmails),
      normalizedGuestEmails(current.guestEmails)
    ) ||
    !recurrenceLinesEqual(initial.recurrenceLines, current.recurrenceLines) ||
    !arraysEqual(initial.reminderMinutes, current.reminderMinutes)
  );
}

export interface CreateCalendarEventFormControllerOptions {
  initialValue: EventEditorInitialValues;
  /** Editing a saved event, whose initial guests already hold an invitation. */
  isEdit?: boolean;
  calendarOptions: Accessor<EventEditorCalendarOption[]>;
  guestOptions: Accessor<EventEditorGuestOption[]>;
  recurrenceTimeZone?: string;
  onChange?: (value: EventEditorInitialValues) => void;
}

function cloneValue(value: EventEditorInitialValues): EventEditorInitialValues {
  return {
    ...value,
    recurrenceLines: [...value.recurrenceLines],
    reminders: value.reminders
      ? {
          ...value.reminders,
          overrides: value.reminders.overrides?.map((reminder) => ({
            ...reminder,
          })),
        }
      : undefined,
  };
}

function normalizedReminderMinutes(minutes: readonly number[]) {
  return [...new Set(minutes)].sort((first, second) => first - second);
}

/** Caller-owned state and commands for the reusable calendar event form. */
export function createCalendarEventFormController(
  options: CreateCalendarEventFormControllerOptions
) {
  const [initialValue, setInitialValue] = createSignal(
    cloneValue(options.initialValue)
  );
  const [state, setState] = createSignal(cloneValue(options.initialValue));

  const initialGuests = initialGuestOptions(
    options.initialValue.guests,
    options.guestOptions()
  );

  const [initialGuestEmails, setInitialGuestEmails] = createSignal(
    initialGuests.map(guestEmail)
  );

  const [selectedGuests, setSelectedGuestsState] =
    createSignal<SelectedEventEditorGuest[]>(initialGuests);

  const recurrence = createEventEditorState({
    initialValues: options.initialValue,
    state,
    recurrenceTimeZone: options.recurrenceTimeZone,
  });

  const effectiveCalendarId = () =>
    state().calendarId ?? options.calendarOptions()[0]?.id;

  const calendarOptionFor = (calendarId: string | undefined) =>
    options
      .calendarOptions()
      .find(
        (option) =>
          option.id === (calendarId ?? options.calendarOptions()[0]?.id)
      ) ?? options.calendarOptions()[0];

  const selectedCalendarOption = () => calendarOptionFor(state().calendarId);

  const resolvedReminderMinutesFor = (values: EventEditorInitialValues) =>
    normalizedReminderMinutes(
      popupMinutes(
        resolveReminderOverrides(
          values.reminders,
          calendarOptionFor(values.calendarId)?.defaultReminders,
          values.eventType
        )
      )
    );
  const baselineReminderMinutes = () => resolvedReminderMinutesFor(state());
  const initialReminderMinutes = () =>
    resolvedReminderMinutesFor(initialValue());
  const [reminderEdits, setReminderEdits] = createSignal<
    number[] | undefined
  >();
  const reminderMinutes = createMemo(
    () => reminderEdits() ?? baselineReminderMinutes()
  );
  const preservedReminderCount = createMemo(() => {
    const reminders = state().reminders;
    if (!reminders || reminders.useDefault) return 0;
    return (reminders.overrides ?? []).filter(
      (reminder) => reminder.method !== REMINDER_METHOD_POPUP
    ).length;
  });
  const canAddReminder = () =>
    reminderMinutes().length + preservedReminderCount() <
    REMINDER_OVERRIDES_MAX;
  const reminderUpdate = () => {
    const edits = reminderEdits();
    if (
      edits === undefined ||
      arraysEqual(
        normalizedReminderMinutes(edits),
        normalizedReminderMinutes(baselineReminderMinutes())
      )
    ) {
      return undefined;
    }
    return buildReminderOverrides(edits, state().reminders);
  };

  const effectiveRecurrenceLines = () =>
    recurrence.recurrenceLines() ?? initialValue().recurrenceLines;

  const value = createMemo<EventEditorInitialValues>(() => {
    const reminders = reminderUpdate();
    return {
      ...state(),
      recurrenceLines: [...effectiveRecurrenceLines()],
      guests: selectedGuests().map(guestEmail).join(', '),
      reminders: reminders ?? state().reminders,
    };
  });

  const snapshot = (): EventComposerFormSnapshot => ({
    title: state().title,
    allDay: state().allDay,
    start: state().start,
    end: state().end,
    recurrenceLines: effectiveRecurrenceLines(),
    calendarId: effectiveCalendarId(),
    guestEmails: selectedGuests().map(guestEmail),
    location: state().location,
    description: state().description,
    conference: state().conference,
    reminderMinutes: normalizedReminderMinutes(reminderMinutes()),
  });

  const initialSnapshot = (): EventComposerFormSnapshot => ({
    title: initialValue().title,
    allDay: initialValue().allDay,
    start: initialValue().start,
    end: initialValue().end,
    recurrenceLines: initialValue().recurrenceLines,
    calendarId: initialValue().calendarId ?? options.calendarOptions()[0]?.id,
    guestEmails: initialGuestEmails(),
    location: initialValue().location,
    description: initialValue().description,
    conference: initialValue().conference,
    reminderMinutes: normalizedReminderMinutes(initialReminderMinutes()),
  });

  const isDirty = createMemo(() =>
    isEventComposerFormDirty(initialSnapshot(), snapshot())
  );

  const invitesNewGuests = () => {
    // An unsaved event has invited nobody yet, no matter how its guest list
    // was seeded: a calendar drag, or an event the assistant proposed.
    if (options.isEdit !== true) return selectedGuests().length > 0;
    const alreadyInvited = new Set(normalizedGuestEmails(initialGuestEmails()));
    return normalizedGuestEmails(selectedGuests().map(guestEmail)).some(
      (email) => !alreadyInvited.has(email)
    );
  };

  const timeChanged = () =>
    initialValue().allDay !== state().allDay ||
    initialValue().start !== state().start ||
    initialValue().end !== state().end;

  // Inviting people to an event that already happened is nearly always a
  // mistake, so the composer says so without blocking the save. Simply
  // reopening a finished event stays quiet: only a new guest or a moved time
  // sends anyone a fresh invitation.
  const pastEventWarning = createMemo(() => {
    if (selectedGuests().length === 0) return undefined;
    if (!invitesNewGuests() && !timeChanged()) return undefined;
    return eventHasEnded(state()) ? PAST_EVENT_GUESTS_WARNING : undefined;
  });

  const notifyChange = () => options.onChange?.(value());

  const setReminderMinutes = (minutes: number[]) => {
    const normalized = normalizedReminderMinutes(minutes);
    if (arraysEqual(normalized, normalizedReminderMinutes(reminderMinutes()))) {
      return;
    }
    setReminderEdits(normalized);
    notifyChange();
  };
  const replaceState = (next: EventEditorInitialValues) => {
    setState(cloneValue(next));
    notifyChange();
  };

  const setField = <Key extends keyof EventEditorInitialValues>(
    field: Key,
    next: EventEditorInitialValues[Key]
  ) => replaceState({ ...state(), [field]: next });

  const setStart = (start: string) =>
    replaceState(
      state().allDay ? moveAllDayRange(state(), start) : { ...state(), start }
    );

  const setAllDay = (allDay: boolean) =>
    replaceState(convertTimesForAllDay(state(), allDay));

  const setSelectedGuests = (guests: SelectedEventEditorGuest[]) => {
    batch(() => {
      setSelectedGuestsState(guests);
      setState({
        ...state(),
        guests: guests.map(guestEmail).join(', '),
      });
    });
    notifyChange();
  };

  const changeRecurrenceChoice = (choice: string) => {
    recurrence.changeRecurrenceChoice(choice);
    notifyChange();
  };

  const setCustomConfig: typeof recurrence.setCustomConfig = (next) => {
    recurrence.setCustomConfig(next);
    notifyChange();
  };

  const submitValues = (): EventEditorSubmitValues | undefined => {
    const time = recurrence.eventTime();
    if (!time || !recurrence.canSave()) return undefined;
    const current = state();
    const reminders = reminderUpdate();
    const conference =
      current.conference === 'existing' ||
      current.conference === initialValue().conference
        ? undefined
        : current.conference;
    return {
      title: current.title,
      time,
      recurrenceLines: recurrence.recurrenceLines(),
      calendarId: effectiveCalendarId(),
      guestEmails: selectedGuests().map(guestEmail),
      location: current.location,
      description: current.description,
      ...(conference ? { conference } : {}),
      ...(reminders ? { reminders } : {}),
    };
  };

  const replaceFromExternal = (next: EventEditorInitialValues) => {
    const cloned = cloneValue(next);
    const guests = initialGuestOptions(next.guests, options.guestOptions());
    batch(() => {
      setInitialValue(cloned);
      setState(cloned);
      setInitialGuestEmails(guests.map(guestEmail));
      setSelectedGuestsState(guests);
      setReminderEdits(undefined);
      recurrence.replaceInitialValues(cloned);
    });
  };

  return {
    state,
    value,
    calendarOptions: options.calendarOptions,
    guestOptions: options.guestOptions,
    selectedGuests,
    effectiveCalendarId,
    selectedCalendarOption,
    initialConferenceChoice: () => initialValue().conference,
    reminderMinutes,
    preservedReminderCount,
    canAddReminder,
    setReminderMinutes,
    setField,
    setStart,
    setAllDay,
    setSelectedGuests,
    startForRecurrence: recurrence.startForRecurrence,
    recurrenceChoice: recurrence.recurrenceChoice,
    recurrenceOptions: recurrence.recurrenceOptions,
    selectedRecurrenceOption: recurrence.selectedRecurrenceOption,
    customConfig: recurrence.customConfig,
    setCustomConfig,
    changeRecurrenceChoice,
    recurrenceLines: recurrence.recurrenceLines,
    dateRangeError: recurrence.dateRangeError,
    pastEventWarning,
    eventTime: recurrence.eventTime,
    canSave: recurrence.canSave,
    snapshot,
    isDirty,
    submitValues,
    replaceFromExternal,
  };
}

export type CalendarEventFormController = ReturnType<
  typeof createCalendarEventFormController
>;
