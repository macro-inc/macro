import { toast } from '@core/component/Toast/Toast';
import { recipientEntityMapper, useContacts } from '@core/user';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import {
  useCreateCalendarEventMutation,
  useUpdateCalendarEventMutation,
} from '@queries/calendar/mutations';
import { type Accessor, createMemo } from 'solid-js';
import { calendarDisplayLabel, spansMultipleInboxes } from '../calendar-label';
import {
  calendarEventToEditorInitialValues,
  type EventEditorDisabledFields,
  type EventEditorSubmitValues,
} from './EventEditorForm';
import type { CalendarEvent } from './types';

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

  const calendarsQuery = useVisibleCalendarsQuery(() => ({
    enabled: !isEdit(),
  }));
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
      return [
        {
          id: event.calendar.id,
          label: event.calendar.name || 'Calendar',
        },
      ];
    }

    return writableCalendars().map((calendar) => ({
      id: calendar.id,
      label: calendarDisplayLabel(calendar, spansInboxes()),
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
    });
  };

  const showRecurringEditNotice = () =>
    isEdit() &&
    ((props.event()?.recurrenceLines.length ?? 0) > 0 ||
      props.event()?.recurrenceId !== undefined);

  return {
    initialValues,
    disabledFields: isEdit() ? EDIT_DISABLED_FIELDS : undefined,
    calendarOptions,
    guestOptions,
    showRecurringEditNotice,
    pending,
    save,
  };
}
