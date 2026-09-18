import { getMeetingUrl } from '@channel/Call/call-link';
import { toast } from '@core/component/Toast/Toast';
import { recipientEntityMapper, useContacts } from '@core/user';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import {
  useCreateCalendarEventMutation,
  useUpdateCalendarEventMutation,
} from '@queries/calendar/mutations';
import {
  fetchMeeting,
  useCreateMeetingMutation,
  useUpdateMeetingMutation,
} from '@queries/call/meetings';
import type { CalendarUpdateScope } from '@service-email/client';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import {
  calendarEventToEditorInitialValues,
  type EventEditorDisabledFields,
  type EventEditorSubmitValues,
} from '../components/composer/event-form-model';
import {
  type CalendarEvent,
  DEFAULT_CALENDAR_SOURCE,
  reminderCalendarIdOf,
} from '../types';
import {
  calendarDisplayLabel,
  spansMultipleInboxes,
} from '../utils/calendar-label';
import {
  guestListChanged,
  viewerCanEditGuests,
} from '../utils/event-guest-editing';
import {
  attachCalendarMacroCall,
  calendarMacroCallUrl,
  removeCalendarMacroCall,
} from '../utils/macro-call-link';

const EDIT_DISABLED_FIELDS = {
  calendar: true,
} satisfies EventEditorDisabledFields;

/**
 * Whether the editor addresses the copy whose reminders Macro's alerts
 * follow and whose guests and conferencing Macro records. Another copy's
 * reminders are Google's own and never fire here, and guests or a Meet link
 * written onto another copy never reach the event Macro shows.
 */
function editsPrimaryCopy(event: CalendarEvent) {
  return reminderCalendarIdOf(event) === event.calendarId;
}

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
      const calendars = calendarsQuery.data ?? [];
      const calendar = calendars.find(
        (candidate) => candidate.id === calendarId
      );
      const reminderCalendar = calendars.find(
        (candidate) => candidate.id === reminderCalendarIdOf(event)
      );
      return [
        {
          id: calendarId,
          label: event.calendar.name || 'Calendar',
          color: event.calendar.color,
          defaultReminders: reminderCalendar?.defaultReminders,
          isPrimary: calendar?.isPrimary ?? event.calendar.isPrimary,
        },
      ];
    }

    return writableCalendars().map((calendar) => ({
      id: calendar.id,
      label: calendarDisplayLabel(calendar, spansInboxes()),
      color: calendar.color ?? DEFAULT_CALENDAR_SOURCE.color,
      defaultReminders: calendar.defaultReminders,
      isPrimary: calendar.isPrimary,
    }));
  });

  const updateMeeting = useUpdateMeetingMutation();
  const create = useCreateCalendarEventMutation();
  const update = useUpdateCalendarEventMutation();

  const createMeeting = useCreateMeetingMutation();
  const [pending, setPending] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string>();
  // If adding the link fails, retry the same saved event and meeting.
  const [createdEvent, setCreatedEvent] = createSignal<{
    id: string;
    calendarId?: string;
  }>();
  const [createdMeetingUrl, setCreatedMeetingUrl] = createSignal<string>();
  const macroCallUrl = () =>
    createdMeetingUrl() ??
    (props.event() ? calendarMacroCallUrl(props.event()!) : undefined);

  const meetingSchedule = (values: EventEditorSubmitValues) =>
    values.time.kind === 'timed'
      ? {
          scheduledStart: values.time.startsAt,
          scheduledEnd: values.time.endsAt,
        }
      : { clearSchedule: true as const };

  const createScheduledMeeting = async (values: EventEditorSubmitValues) => {
    const existingUrl = createdMeetingUrl();
    if (existingUrl) {
      await syncScheduledMeeting(existingUrl, values);
      return existingUrl;
    }
    const meeting = await createMeeting.mutateAsync({
      title: values.title,
      ...(values.time.kind === 'timed'
        ? {
            scheduledStart: values.time.startsAt,
            scheduledEnd: values.time.endsAt,
          }
        : {}),
    });
    const url = getMeetingUrl(meeting.shareToken);
    setCreatedMeetingUrl(url);
    return url;
  };

  const syncScheduledMeeting = async (
    url: string,
    values: EventEditorSubmitValues
  ) => {
    const shareToken = new URL(url).pathname.split('/').at(-1);
    if (!shareToken) return;
    const meeting = await fetchMeeting(shareToken);
    await updateMeeting.mutateAsync({
      meetingId: meeting.id,
      title: values.title,
      ...meetingSchedule(values),
    });
  };

  const save = async (
    values: EventEditorSubmitValues,
    scope?: CalendarUpdateScope
  ) => {
    if (pending()) return;
    setPending(true);
    setSaveError(undefined);

    const event = props.event();
    const existingMeetingUrl = event ? calendarMacroCallUrl(event) : undefined;
    const cleanContent = removeCalendarMacroCall(values, existingMeetingUrl);
    let calendarSaved = false;

    try {
      if (!event) {
        const eventValues = {
          title: values.title,
          time: values.time,
          calendarId: values.calendarId,
          recurrenceLines: values.recurrenceLines ?? [],
          location:
            cleanContent.location === '' ? undefined : cleanContent.location,
          description:
            cleanContent.description === ''
              ? undefined
              : cleanContent.description,
          attendees: values.guestEmails.map((email) => ({ email })),
          ...(values.conference ? { conference: values.conference } : {}),
          ...(values.reminders ? { reminders: values.reminders } : {}),
          ...(values.outOfOffice ? { outOfOffice: values.outOfOffice } : {}),
        };
        let created = createdEvent();
        if (created) {
          await update.mutateAsync({
            eventId: created.id,
            calendarId: created.calendarId,
            patch: {
              ...eventValues,
              location: cleanContent.location,
              description: cleanContent.description,
            },
          });
        } else {
          const result = await create.mutateAsync(eventValues);
          created = {
            id: result.id,
            calendarId: values.calendarId ?? result.calendarId ?? undefined,
          };
          setCreatedEvent(created);
        }
        calendarSaved = true;

        if (values.macroCall) {
          const meetingUrl = await createScheduledMeeting(values);
          const linkedContent = attachCalendarMacroCall(
            cleanContent,
            meetingUrl
          );
          await update.mutateAsync({
            eventId: created.id,
            calendarId: created.calendarId ?? values.calendarId,
            patch: {
              location: linkedContent.location,
              description: linkedContent.description,
            },
          });
        }
        props.onSaved();
        return;
      }

      const effectiveScope: CalendarUpdateScope = scope ?? 'all';
      const targetsOneOccurrence = effectiveScope === 'this_event';
      const content =
        values.macroCall && existingMeetingUrl
          ? attachCalendarMacroCall(
              cleanContent,
              existingMeetingUrl,
              existingMeetingUrl
            )
          : cleanContent;

      // A single occurrence has no recurrence of its own, and the provider
      // rejects a recurrence-carrying patch scoped to one event, so recurrence
      // lines only travel with a whole-series edit. Under `this_event` the
      // recurrence controls are read-only, so any diff here is an incidental
      // re-serialization (e.g. a date-dependent preset regenerated by a
      // reschedule), not an intended rule change.
      const recurrenceChanged =
        !targetsOneOccurrence &&
        values.recurrenceLines !== undefined &&
        values.recurrenceLines.join('\n') !== initialLines().join('\n');

      const updateArgs = {
        eventId: event.eventId,
        calendarId: event.calendarId,
        scope: effectiveScope,
        recurrenceId: targetsOneOccurrence
          ? (event.recurrenceId ?? event.occurrenceKey)
          : undefined,
        occurrenceKey: targetsOneOccurrence ? event.occurrenceKey : undefined,
        patch: {
          title: values.title,
          time: values.time,
          location: content.location,
          description: content.description,
          ...(recurrenceChanged
            ? { recurrenceLines: values.recurrenceLines }
            : {}),
          ...(guestListChanged(event, values.guestEmails)
            ? {
                attendees: values.guestEmails.map((email) => ({ email })),
              }
            : {}),
          ...(values.conference ? { conference: values.conference } : {}),
          ...(values.reminders ? { reminders: values.reminders } : {}),
          ...(values.outOfOffice ? { outOfOffice: values.outOfOffice } : {}),
        },
      };
      await update.mutateAsync(updateArgs);
      calendarSaved = true;

      if (values.macroCall && !existingMeetingUrl) {
        const meetingUrl = await createScheduledMeeting(values);
        const linkedContent = attachCalendarMacroCall(cleanContent, meetingUrl);
        await update.mutateAsync({
          ...updateArgs,
          patch: {
            location: linkedContent.location,
            description: linkedContent.description,
          },
        });
      } else if (values.macroCall && existingMeetingUrl) {
        await syncScheduledMeeting(existingMeetingUrl, values);
      }
      props.onSaved();
    } catch (error) {
      const subtext = error instanceof Error ? error.message : undefined;
      if (calendarSaved) {
        if (existingMeetingUrl) {
          toast.alert('Event saved, but call details could not be updated');
          props.onSaved();
        } else {
          setSaveError(
            'Your event is saved, but its call link could not be added. Save again to retry.'
          );
        }
      } else {
        toast.failure(
          event ? 'Failed to update event' : 'Failed to create event',
          { subtext }
        );
      }
    } finally {
      setPending(false);
    }
  };

  const showRecurringEditNotice = () =>
    isEdit() &&
    ((props.event()?.recurrenceLines.length ?? 0) > 0 ||
      props.event()?.recurrenceId !== undefined);
  const disabledFields = createMemo<EventEditorDisabledFields | undefined>(
    () => {
      const event = props.event();
      if (!event) return createdEvent() ? EDIT_DISABLED_FIELDS : undefined;
      const editsOtherCopy = !editsPrimaryCopy(event);
      return {
        ...EDIT_DISABLED_FIELDS,
        guests: editsOtherCopy || !viewerCanEditGuests(event),
        conference: editsOtherCopy,
        reminders: editsOtherCopy,
      };
    }
  );

  return {
    initialValues,
    disabledFields,
    calendarOptions,
    guestOptions,
    showRecurringEditNotice,
    pending,
    saveError,
    macroCallUrl,
    eventCreated: () => createdEvent() !== undefined,
    save,
  };
}
