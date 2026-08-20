import { toast } from '@core/component/Toast/Toast';
import { recipientEntityMapper, useContacts } from '@core/user';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import {
  useCreateCalendarEventMutation,
  useUpdateCalendarEventMutation,
} from '@queries/calendar/mutations';
import { type Accessor, createMemo } from 'solid-js';
import {
  calendarEventToEditorInitialValues,
  type EventEditorDisabledFields,
  type EventEditorSubmitValues,
} from '../components/composer/event-form-model';
import type { CalendarEvent } from '../types';
import { DEFAULT_CALENDAR_SOURCE } from '../types';
import {
  calendarDisplayLabel,
  spansMultipleInboxes,
} from '../utils/calendar-label';

const EDIT_DISABLED_FIELDS = {
  calendar: true,
  guests: true,
} satisfies EventEditorDisabledFields;

interface UseEventEditorProps {
  event: Accessor<CalendarEvent | undefined>;
  onSaved: () => void;
}

/** Shared create/edit query and mutation orchestration for any editor shell. */
export function useEventEditor(props: UseEventEditorProps) {
  const isEdit = () => props.event() !== undefined;
  const initialValues = createMemo(() => {
    const event = props.event();
    return event ? calendarEventToEditorInitialValues(event) : undefined;
  });
  const initialLines = createMemo(() => props.event()?.recurrenceLines ?? []);

  // Event edits also need calendar metadata to resolve reminders that still
  // follow the calendar defaults.
  const calendarsQuery = useVisibleCalendarsQuery();
  const contacts = useContacts();

  const guestOptions = createMemo(() =>
    contacts().map(recipientEntityMapper('user'))
  );
  const writableCalendars = createMemo(
    () => calendarsQuery.data?.filter((calendar) => calendar.isWritable) ?? []
  );
  const spansInboxes = createMemo(() =>
    spansMultipleInboxes(writableCalendars())
  );
  const calendarOptions = createMemo(() => {
    const event = props.event();
    if (event) {
      const calendarId = event.calendarId ?? event.calendar.id;
      const calendar = calendarsQuery.data?.find(
        (candidate) => candidate.id === calendarId
      );
      return [
        {
          id: calendarId,
          label: event.calendar.name || 'Calendar',
          color: event.calendar.color,
          defaultReminders: calendar?.defaultReminders,
        },
      ];
    }

    return writableCalendars().map((calendar) => ({
      id: calendar.id,
      label: calendarDisplayLabel(calendar, spansInboxes()),
      color: calendar.color ?? DEFAULT_CALENDAR_SOURCE.color,
      defaultReminders: calendar.defaultReminders,
    }));
  });

  const create = useCreateCalendarEventMutation({
    onSuccess: props.onSaved,
    onError: (error) => {
      toast.failure('Failed to create event', { subtext: error.message });
    },
  });
  const update = useUpdateCalendarEventMutation({
    onSuccess: props.onSaved,
    onError: (error) => {
      toast.failure('Failed to update event', { subtext: error.message });
    },
  });

  const pending = () => create.isPending || update.isPending;

  const save = (values: EventEditorSubmitValues) => {
    if (pending()) return;

    const event = props.event();
    if (event) {
      const recurrenceChanged =
        values.recurrenceLines !== undefined &&
        values.recurrenceLines.join('\n') !== initialLines().join('\n');

      update.mutate({
        eventId: event.eventId,
        patch: {
          title: values.title,
          time: values.time,
          location: values.location,
          description: values.description,
          ...(recurrenceChanged
            ? { recurrenceLines: values.recurrenceLines }
            : {}),
          ...(values.conference ? { conference: values.conference } : {}),
          ...(values.reminders ? { reminders: values.reminders } : {}),
        },
      });
      return;
    }

    create.mutate({
      title: values.title,
      time: values.time,
      calendarId: values.calendarId,
      recurrenceLines: values.recurrenceLines ?? [],
      location: values.location === '' ? undefined : values.location,
      description: values.description === '' ? undefined : values.description,
      attendees: values.guestEmails.map((email) => ({ email })),
      ...(values.conference ? { conference: values.conference } : {}),
      ...(values.reminders ? { reminders: values.reminders } : {}),
    });
  };

  const showRecurringEditNotice = () =>
    isEdit() &&
    ((props.event()?.recurrenceLines.length ?? 0) > 0 ||
      props.event()?.recurrenceId !== undefined);
  const disabledFields = createMemo(() =>
    isEdit() ? EDIT_DISABLED_FIELDS : undefined
  );

  return {
    initialValues,
    disabledFields,
    calendarOptions,
    guestOptions,
    showRecurringEditNotice,
    pending,
    save,
  };
}
