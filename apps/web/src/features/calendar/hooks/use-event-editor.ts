import { getMeetingShareToken, getMeetingUrl } from '@channel/Call/call-link';
import { toast } from '@core/component/Toast/Toast';
import { recipientEntityMapper, useContacts } from '@core/user';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import {
  isGuestEditRefused,
  useCreateCalendarEventMutation,
  useInviteCalendarEventGuestsMutation,
  useUpdateCalendarEventMutation,
} from '@queries/calendar/mutations';
import {
  fetchMeeting,
  useCreateMeetingMutation,
  useUpdateMeetingMutation,
} from '@queries/call/meetings';
import type { CalendarUpdateScope } from '@service-email/client';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  buildEventTime,
  calendarEventToEditorInitialValues,
  type EventEditorDisabledFields,
  type EventEditorSubmitValues,
} from '../components/composer/event-form-model';
import {
  type CalendarEvent,
  DEFAULT_CALENDAR_SOURCE,
  reminderCalendarIdOf,
} from '../types';
import { isTimedPointEvent } from '../utils/calendar-date';
import {
  calendarDisplayLabel,
  spansMultipleInboxes,
} from '../utils/calendar-label';
import {
  addedGuestEmails,
  type EventGuestEditing,
  eventGuestEditing,
  GUEST_EDITS_RESTRICTED,
  guestEditsRestricted,
  guestInvitesRestrictedReason,
  guestListChanged,
  guestListHidden,
  viewerReplacesGuests,
} from '../utils/event-guest-editing';
import {
  attachCalendarMacroCall,
  calendarMacroCallUrl,
  removeCalendarMacroCall,
} from '../utils/macro-call-link';

const EDIT_DISABLED_FIELDS = {
  calendar: true,
} satisfies EventEditorDisabledFields;

/** What a guest the organizer does not let modify the event cannot change. */
const DETAIL_FIELDS = {
  title: true,
  allDay: true,
  start: true,
  end: true,
  recurrence: true,
  location: true,
  description: true,
  outOfOffice: true,
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

function hasTimeChanged(
  event: CalendarEvent,
  time: EventEditorSubmitValues['time']
) {
  // Compare at the editor's precision, which omits seconds. An unchanged
  // occurrence must not replace the series start or its provider time zone.
  const initialValues = calendarEventToEditorInitialValues(event);
  const initial =
    buildEventTime(initialValues) ?? initialValues.importedPointTime;
  return match([initial, time])
    .with(
      [{ kind: 'timed' }, { kind: 'timed' }],
      ([before, after]) =>
        new Date(before.startsAt).getTime() !==
          new Date(after.startsAt).getTime() ||
        new Date(before.endsAt).getTime() !== new Date(after.endsAt).getTime()
    )
    .with(
      [{ kind: 'allDay' }, { kind: 'allDay' }],
      ([before, after]) =>
        before.startDate !== after.startDate || before.endDate !== after.endDate
    )
    .otherwise(() => true);
}

interface UseEventEditorProps {
  event: Accessor<CalendarEvent | undefined>;
  onSaved: () => void;
  macroCallsEnabled: Accessor<boolean>;
  /**
   * Whether the guest-invites rollout is on: a guest the organizer lets
   * invite may add guests, and the organizer may set guest permissions. Off
   * when omitted.
   */
  guestInvitesEnabled?: Accessor<boolean>;
  /**
   * The edited event as the calendar now holds it. The lock on its details
   * follows this copy, so a guest whose organizer stops letting guests
   * modify the event loses the details while the editor is open. The edit
   * itself still compares against `event`, the version it opened with.
   */
  syncedEvent?: Accessor<CalendarEvent | undefined>;
  /**
   * Called when the details lock while the editor is open, because the
   * server refused a detail change or the synced event no longer lets the
   * viewer change them, so the form can return them to the event's own
   * instead of holding changes it can no longer save.
   */
  onDetailsLocked?: () => void;
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
      const calendars = calendarsQuery.isSuccess ? calendarsQuery.data : [];
      const calendar = calendars.find(
        (candidate) => candidate.id === calendarId
      );
      const reminderCalendar = calendars.find(
        (candidate) => candidate.id === reminderCalendarIdOf(event)
      );
      return [
        {
          id: calendarId,
          provider: calendar?.provider ?? event.calendar.provider,
          capabilities: calendar?.capabilities ?? event.calendar.capabilities,
          label: event.calendar.name || 'Calendar',
          color: event.calendar.color,
          defaultReminders: reminderCalendar?.defaultReminders,
          isPrimary: calendar?.isPrimary ?? event.calendar.isPrimary,
        },
      ];
    }

    return writableCalendars().map((calendar) => ({
      id: calendar.id,
      provider: calendar.provider,
      capabilities: calendar.capabilities,
      label: calendarDisplayLabel(calendar, spansInboxes()),
      color: calendar.color ?? DEFAULT_CALENDAR_SOURCE.color,
      defaultReminders: calendar.defaultReminders,
      isPrimary: calendar.isPrimary,
    }));
  });

  /**
   * How an edit may change the guest list. Guests written onto a copy other
   * than the primary one never reach the event Macro shows.
   */
  const guestEditing = createMemo<EventGuestEditing>(() => {
    const event = props.event();
    if (!event) return 'replace';
    if (!editsPrimaryCopy(event)) return 'none';
    return eventGuestEditing(event, props.guestInvitesEnabled?.() ?? false);
  });
  const guestsReadOnlyReason = () => {
    const event = props.event();
    return event && guestInvitesRestrictedReason(event);
  };
  // A refusal means the stored guest policy was newer than the event shown,
  // so the details lock without waiting for the refetch.
  const [detailEditsRefused, setDetailEditsRefused] = createSignal(false);
  const detailsLocked = () => {
    const event = props.event();
    if (!event) return false;
    return (
      detailEditsRefused() ||
      guestEditsRestricted(props.syncedEvent?.() ?? event)
    );
  };
  // The lock can arrive from outside the form, with the synced event, so the
  // form is told rather than asked. The first run has no earlier state and
  // only records the lock the editor opened with.
  createEffect(
    on(detailsLocked, (locked, wasLocked) => {
      if (!locked || wasLocked !== false) return;
      props.onDetailsLocked?.();
      // A refused save already says why.
      if (!detailEditsRefused()) toast.alert(GUEST_EDITS_RESTRICTED);
    })
  );

  const updateMeeting = useUpdateMeetingMutation();
  const create = useCreateCalendarEventMutation();
  const update = useUpdateCalendarEventMutation();
  const invite = useInviteCalendarEventGuestsMutation();

  const createMeeting = useCreateMeetingMutation();
  const [pending, setPending] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string>();
  // If attaching the link to an existing event fails, retry the same meeting.
  const [createdMeeting, setCreatedMeeting] = createSignal<{
    url: string;
    shareToken: string;
  }>();
  const meetingSchedule = (values: EventEditorSubmitValues) =>
    values.time.kind === 'timed'
      ? {
          scheduledStart: values.time.startsAt,
          scheduledEnd: values.time.endsAt,
        }
      : {
          scheduledStart: null,
          scheduledEnd: null,
        };

  const createScheduledMeeting = async (values: EventEditorSubmitValues) => {
    const existing = createdMeeting();
    if (existing) {
      await syncScheduledMeeting(existing.shareToken, values);
      return existing.url;
    }
    const meeting = await createMeeting.mutateAsync({
      title: values.title,
      ...meetingSchedule(values),
    });
    const url = getMeetingUrl(meeting.shareToken);
    setCreatedMeeting({ url, shareToken: meeting.shareToken });
    return url;
  };

  const syncScheduledMeeting = async (
    shareToken: string,
    values: EventEditorSubmitValues
  ) => {
    const meeting = await fetchMeeting(shareToken);
    if (!props.macroCallsEnabled()) return;
    const event = props.event();
    const preservesPoint =
      event && isTimedPointEvent(event) && !hasTimeChanged(event, values.time);
    await updateMeeting.mutateAsync({
      meetingId: meeting.id,
      ...(values.time.kind === 'allDay' ? { clearSchedule: true } : {}),
      title: values.title,
      ...(preservesPoint ? {} : meetingSchedule(values)),
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
    const wantsMacroCall =
      values.conferenceChoice === 'macro' &&
      !values.outOfOffice &&
      event?.eventType !== 'out_of_office';
    const needsCall = () => props.macroCallsEnabled() && wantsMacroCall;
    const canManageCall =
      !event || (editsPrimaryCopy(event) && viewerReplacesGuests(event));
    if (
      needsCall() &&
      canManageCall &&
      !existingMeetingUrl &&
      values.time.kind === 'timed' &&
      Date.parse(values.time.endsAt) <= Date.parse(values.time.startsAt)
    ) {
      setSaveError('Give this event a duration before adding a Macro call.');
      setPending(false);
      return;
    }
    // Older events can carry both a generated Macro link and provider
    // conferencing. Use the saved provider state when clearing either choice.
    const conference =
      values.conference ??
      (canManageCall &&
      !values.outOfOffice &&
      event?.eventType !== 'out_of_office' &&
      event?.conferenceUrl &&
      (values.conferenceChoice === 'macro' ||
        values.conferenceChoice === 'none')
        ? 'none'
        : undefined);
    let calendarSaved = false;

    try {
      if (!event) {
        // The server mints the call and writes its link into the event, so
        // the one invitation attendees receive already carries it.
        await create.mutateAsync({
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
          ...(conference ? { conference } : {}),
          ...(needsCall() ? { macroCall: true } : {}),
          ...(values.reminders ? { reminders: values.reminders } : {}),
          ...(values.outOfOffice ? { outOfOffice: values.outOfOffice } : {}),
          ...(values.guestPolicy ? { guestPolicy: values.guestPolicy } : {}),
        });
        props.onSaved();
        return;
      }

      const effectiveScope: CalendarUpdateScope = scope ?? 'all';
      const targetsOneOccurrence = effectiveScope === 'this_event';
      const initialContent = removeCalendarMacroCall(event, existingMeetingUrl);
      const content =
        event.eventType === 'out_of_office' ||
        (existingMeetingUrl &&
          wantsMacroCall &&
          cleanContent.location === initialContent.location &&
          cleanContent.description === initialContent.description)
          ? {
              location: event.location ?? '',
              description: event.description ?? '',
            }
          : existingMeetingUrl && wantsMacroCall
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

      // A guest's additions go out as an invitation, which leaves the rest of
      // the guest list alone; only the organizer's save replaces the list.
      const invitedEmails =
        guestEditing() === 'add'
          ? addedGuestEmails(event, values.guestEmails)
          : [];
      const detailChanges = {
        ...(values.title !== event.title ? { title: values.title } : {}),
        ...(hasTimeChanged(event, values.time) ? { time: values.time } : {}),
        ...(content.location !== (event.location ?? '')
          ? { location: content.location }
          : {}),
        ...(content.description !== (event.description ?? '')
          ? { description: content.description }
          : {}),
        ...(recurrenceChanged
          ? { recurrenceLines: values.recurrenceLines }
          : {}),
        ...(conference ? { conference } : {}),
        ...(values.outOfOffice ? { outOfOffice: values.outOfOffice } : {}),
      };
      const updateArgs = {
        eventId: event.eventId,
        calendarId: event.calendarId,
        scope: effectiveScope,
        recurrenceId: targetsOneOccurrence
          ? (event.recurrenceId ?? event.occurrenceKey)
          : undefined,
        occurrenceKey: targetsOneOccurrence ? event.occurrenceKey : undefined,
        patch: {
          // A guest who may not modify the event sends only their own fields.
          ...(detailsLocked() ? {} : detailChanges),
          ...(guestEditing() === 'replace' &&
          guestListChanged(event, values.guestEmails)
            ? {
                attendees: values.guestEmails.map((email) => ({ email })),
              }
            : {}),
          ...(values.reminders ? { reminders: values.reminders } : {}),
          ...(values.guestPolicy &&
          event.viewerCan.setGuestPolicy &&
          !targetsOneOccurrence
            ? { guestPolicy: values.guestPolicy }
            : {}),
        },
      };
      if (Object.keys(updateArgs.patch).length > 0) {
        await update.mutateAsync(updateArgs);
      }
      if (invitedEmails.length > 0) {
        await invite.mutateAsync({
          eventId: updateArgs.eventId,
          calendarId: updateArgs.calendarId,
          guests: invitedEmails.map((email) => ({ email })),
          scope: updateArgs.scope,
          recurrenceId: updateArgs.recurrenceId,
          occurrenceKey: updateArgs.occurrenceKey,
        });
      }
      calendarSaved = true;

      if (needsCall() && canManageCall && !existingMeetingUrl) {
        const meetingUrl = await createScheduledMeeting(values);
        const linkedContent = attachCalendarMacroCall(cleanContent, meetingUrl);
        if (needsCall())
          await update.mutateAsync({
            ...updateArgs,
            patch: {
              location: linkedContent.location,
              description: linkedContent.description,
            },
          });
      } else if (needsCall() && canManageCall && existingMeetingUrl) {
        const shareToken = getMeetingShareToken(existingMeetingUrl);
        if (shareToken) await syncScheduledMeeting(shareToken, values);
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
      } else if (event && isGuestEditRefused(error)) {
        setDetailEditsRefused(true);
        toast.failure(GUEST_EDITS_RESTRICTED);
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
      if (!event) return undefined;
      const editsOtherCopy = !editsPrimaryCopy(event);
      return {
        ...EDIT_DISABLED_FIELDS,
        ...(detailsLocked() ? DETAIL_FIELDS : {}),
        guests: guestEditing() === 'none',
        conference: editsOtherCopy || !viewerReplacesGuests(event),
        reminders: editsOtherCopy,
      };
    }
  );

  return {
    initialValues,
    disabledFields,
    addOnlyGuests: () => guestEditing() === 'add',
    guestsReadOnlyReason,
    guestListHidden: () => {
      const event = props.event();
      return event !== undefined && guestListHidden(event);
    },
    /** The organizer sets what guests may do; a new event is the viewer's own. */
    guestPolicyEditable: () =>
      (props.guestInvitesEnabled?.() ?? false) &&
      (props.event()?.viewerCan.setGuestPolicy ?? true),
    detailsReadOnlyReason: () =>
      detailsLocked() ? GUEST_EDITS_RESTRICTED : undefined,
    calendarOptions,
    guestOptions,
    showRecurringEditNotice,
    pending,
    saveError,
    save,
  };
}
