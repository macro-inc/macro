import { type Accessor, batch, createMemo, createSignal } from 'solid-js';
import {
  type EventComposerFormSnapshot,
  isEventComposerFormDirty,
} from './event-composer-dirty';
import {
  convertTimesForAllDay,
  createEventEditorState,
  type EventEditorCalendarOption,
  type EventEditorGuestOption,
  type EventEditorInitialValues,
  type EventEditorSubmitValues,
  guestEmail,
  initialGuestOptions,
  moveAllDayRange,
  type SelectedEventEditorGuest,
} from './event-form-model';

export interface CreateCalendarEventFormControllerOptions {
  initialValue: EventEditorInitialValues;
  calendarOptions: Accessor<EventEditorCalendarOption[]>;
  guestOptions: Accessor<EventEditorGuestOption[]>;
  onChange?: (value: EventEditorInitialValues) => void;
}

function cloneValue(value: EventEditorInitialValues): EventEditorInitialValues {
  return { ...value, recurrenceLines: [...value.recurrenceLines] };
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
  });
  const effectiveCalendarId = () =>
    state().calendarId ?? options.calendarOptions()[0]?.id;
  const selectedCalendarOption = () =>
    options
      .calendarOptions()
      .find((option) => option.id === effectiveCalendarId()) ??
    options.calendarOptions()[0];
  const effectiveRecurrenceLines = () =>
    recurrence.recurrenceLines() ?? initialValue().recurrenceLines;
  const value = createMemo<EventEditorInitialValues>(() => ({
    ...state(),
    recurrenceLines: [...effectiveRecurrenceLines()],
    guests: selectedGuests().map(guestEmail).join(', '),
  }));
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
  });
  const isDirty = createMemo(() =>
    isEventComposerFormDirty(initialSnapshot(), snapshot())
  );

  const notifyChange = () => options.onChange?.(value());
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
    return {
      title: current.title,
      time,
      recurrenceLines: recurrence.recurrenceLines(),
      calendarId: effectiveCalendarId(),
      guestEmails: selectedGuests().map(guestEmail),
      location: current.location,
      description: current.description,
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
