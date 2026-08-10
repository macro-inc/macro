import { toast } from '@core/component/Toast/Toast';
import { recipientEntityMapper, useContacts } from '@core/user';
import XIcon from '@phosphor/x.svg';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import {
  useCreateCalendarEventMutation,
  useUpdateCalendarEventMutation,
} from '@queries/calendar/mutations';
import { Button, Dialog, Panel } from '@ui';
import { createMemo } from 'solid-js';
import { calendarDisplayLabel, spansMultipleInboxes } from '../calendar-label';
import {
  calendarEventToEditorInitialValues,
  type EventEditorDisabledFields,
  EventEditorForm,
  type EventEditorSubmitValues,
} from './EventEditorForm';
import type { CalendarEvent } from './types';

const EDIT_DISABLED_FIELDS = {
  calendar: true,
  guests: true,
} satisfies EventEditorDisabledFields;

/**
 * Hosts the shared event form in a dialog and owns create/edit mutations.
 * Editing keeps calendar and guest fields visible but disabled because those
 * values are not safely patchable by the current edit flow.
 */
export function EventEditorDialog(props: {
  open: boolean;
  /** Present when editing; absent when creating. */
  event?: CalendarEvent;
  onClose: () => void;
}) {
  const isEdit = () => props.event !== undefined;
  const initialValues = props.event
    ? calendarEventToEditorInitialValues(props.event)
    : undefined;
  const initialLines = props.event?.recurrenceLines ?? [];

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
    if (props.event) {
      return [
        {
          id: props.event.calendar.id,
          label: props.event.calendar.name || 'Calendar',
        },
      ];
    }
    return writableCalendars().map((calendar) => ({
      id: calendar.id,
      label: calendarDisplayLabel(calendar, spansInboxes()),
    }));
  });

  const create = useCreateCalendarEventMutation({
    onSuccess: () => props.onClose(),
    onError: (error) => {
      toast.failure('Failed to create event', { subtext: error.message });
    },
  });
  const update = useUpdateCalendarEventMutation({
    onSuccess: () => props.onClose(),
    onError: (error) => {
      toast.failure('Failed to update event', { subtext: error.message });
    },
  });
  const pending = () => create.isPending || update.isPending;

  const save = (values: EventEditorSubmitValues) => {
    if (pending()) return;

    const event = props.event;
    if (event) {
      const recurrenceChanged =
        values.recurrenceLines !== undefined &&
        values.recurrenceLines.join('\n') !== initialLines.join('\n');
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

  const isRecurringEdit = () =>
    isEdit() &&
    ((props.event?.recurrenceLines.length ?? 0) > 0 ||
      props.event?.recurrenceId !== undefined);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && !pending() && props.onClose()}
    >
      <Panel
        depth={2}
        class="w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl text-ink"
      >
        <Panel.Header class="gap-1 px-2">
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            disabled={pending()}
          >
            <XIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
            {isEdit() ? 'Edit event' : 'New event'}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body>
          <EventEditorForm
            initialValues={initialValues}
            disabledFields={isEdit() ? EDIT_DISABLED_FIELDS : undefined}
            calendarOptions={calendarOptions()}
            guestOptions={guestOptions}
            showRecurringEditNotice={isRecurringEdit()}
            pending={pending()}
            onCancel={props.onClose}
            onSubmit={save}
          />
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
