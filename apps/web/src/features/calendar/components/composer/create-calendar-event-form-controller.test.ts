import { format } from 'date-fns';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CreateCalendarEventFormControllerOptions,
  createCalendarEventFormController,
} from './create-calendar-event-form-controller';
import {
  defaultEditorInitialValues,
  type EventEditorInitialValues,
  PAST_EVENT_GUESTS_WARNING,
  type SelectedEventEditorGuest,
} from './event-form-model';

const DATETIME_VALUE = "yyyy-MM-dd'T'HH:mm";
const HOUR_MS = 60 * 60 * 1000;

/** A timed range offset from now, in hours, running for one hour. */
function timedRange(startHoursFromNow: number) {
  const start = new Date(Date.now() + startHoursFromNow * HOUR_MS);
  return {
    start: format(start, DATETIME_VALUE),
    end: format(new Date(start.getTime() + HOUR_MS), DATETIME_VALUE),
  };
}

function guest(email: string): SelectedEventEditorGuest {
  return {
    kind: 'custom',
    id: `macro|${email}`,
    data: { id: `macro|${email}`, email, invalid: false },
  };
}

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/**
 * Builds a controller outside any batch, so later edits reach its memos the way
 * a user's edits do.
 */
function controllerFor(
  initialValue: Partial<EventEditorInitialValues>,
  options?: Partial<
    Pick<
      CreateCalendarEventFormControllerOptions,
      'isEdit' | 'calendarOptions' | 'defaultCalendarId'
    >
  >
) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date(), true),
        ...initialValue,
      },
      calendarOptions: () => [
        { id: 'calendar-1', label: 'Calendar', color: '#000000' },
      ],
      guestOptions: () => [],
      ...options,
    });
  });
}

it('never uses an imported point baseline to create a new zero-duration event', () => {
  const controller = controllerFor({
    title: 'New point',
    allDay: false,
    start: '2026-10-10T12:00',
    end: '2026-10-10T12:00',
    importedPointTime: {
      kind: 'timed',
      startsAt: '2026-10-10T12:00:00Z',
      endsAt: '2026-10-10T12:00:00Z',
      timeZone: 'UTC',
    },
  });
  expect(controller.canSave()).toBe(false);
  expect(controller.submitValues()).toBeUndefined();
});

describe('calendar account selection', () => {
  it('waits for the primary account instead of silently using another inbox', () => {
    const [primary, setPrimary] = createSignal<string>();
    const controller = controllerFor(
      { title: 'Customer demo', ...timedRange(24) },
      { defaultCalendarId: primary }
    );
    expect(controller.effectiveCalendarId()).toBeUndefined();
    expect(controller.selectedCalendarOption()).toBeUndefined();
    expect(controller.canSave()).toBe(false);
    expect(controller.submitValues()).toBeUndefined();
    setPrimary('calendar-1');
    expect(controller.canSave()).toBe(true);
    expect(controller.submitValues()?.calendarId).toBe('calendar-1');
  });

  it('allows an explicitly selected alternate calendar while primary is unavailable', () => {
    const controller = controllerFor(
      { title: 'Customer demo', ...timedRange(24) },
      { defaultCalendarId: () => undefined }
    );
    controller.setField('calendarId', 'calendar-1');
    expect(controller.canSave()).toBe(true);
    expect(controller.submitValues()?.calendarId).toBe('calendar-1');
  });

  it('does not switch to another account when the proposed calendar disappears', () => {
    const controller = controllerFor(
      {
        title: 'Customer demo',
        ...timedRange(24),
        calendarId: 'missing-work-calendar',
      },
      { defaultCalendarId: () => 'calendar-1' }
    );
    expect(controller.effectiveCalendarId()).toBe('missing-work-calendar');
    expect(controller.selectedCalendarOption()).toBeUndefined();
    expect(controller.canSave()).toBe(false);
    expect(controller.submitValues()).toBeUndefined();
  });
});

describe('recurrence submission', () => {
  const originalRule =
    'RRULE:FREQ=WEEKLY;WKST=SU;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR';
  const recurringValue = {
    title: 'Prod Deploy',
    start: '2026-10-01T18:00',
    end: '2026-10-01T18:30',
    recurrenceLines: [originalRule],
  };

  it('preserves the original rule when a recurrence edit is reverted', () => {
    const controller = controllerFor(recurringValue, { isEdit: true });
    controller.changeRecurrenceChoice('daily');
    expect(controller.submitValues()?.recurrenceLines).toEqual([
      'RRULE:FREQ=DAILY',
    ]);
    controller.changeRecurrenceChoice('weekdays');
    expect(controller.submitValues()?.recurrenceLines).toEqual([originalRule]);
  });

  it('still submits recurrence removal', () => {
    const controller = controllerFor(recurringValue, { isEdit: true });
    controller.changeRecurrenceChoice('none');
    expect(controller.submitValues()?.recurrenceLines).toEqual([]);
  });

  it('still submits custom recurrence edits', () => {
    const controller = controllerFor(recurringValue, { isEdit: true });
    controller.changeRecurrenceChoice('custom');
    controller.setCustomConfig((config) => ({ ...config, interval: 2 }));
    expect(controller.submitValues()?.recurrenceLines).toEqual([
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR',
    ]);
  });

  it('updates a date-dependent preset when the start day changes', () => {
    const controller = controllerFor(
      { ...recurringValue, recurrenceLines: ['RRULE:FREQ=WEEKLY;BYDAY=TH'] },
      { isEdit: true }
    );
    controller.setStart('2026-10-02T18:00');
    controller.setField('end', '2026-10-02T18:30');
    expect(controller.submitValues()?.recurrenceLines).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=FR',
    ]);
  });

  // October 1, 2026 is a Thursday.
  it('reads a weekly rule without weekdays as the weekly preset and keeps its text', () => {
    const controller = controllerFor(
      { ...recurringValue, recurrenceLines: ['RRULE:FREQ=WEEKLY'] },
      { isEdit: true }
    );
    expect(controller.recurrenceChoice()).toBe('weekly');
    expect(controller.submitValues()?.recurrenceLines).toEqual([
      'RRULE:FREQ=WEEKLY',
    ]);

    // The rule follows the start, as the preset does.
    controller.setStart('2026-10-02T18:00');
    controller.setField('end', '2026-10-02T18:30');
    expect(controller.submitValues()?.recurrenceLines).toEqual([
      'RRULE:FREQ=WEEKLY',
    ]);
  });

  it('opens a weekly rule with an end but no weekdays on the start’s weekday', () => {
    const controller = controllerFor(
      { ...recurringValue, recurrenceLines: ['RRULE:FREQ=WEEKLY;COUNT=3'] },
      { isEdit: true }
    );
    expect(controller.recurrenceChoice()).toBe('custom');
    expect(controller.customConfig().byDay).toEqual(['TH']);
    expect(controller.submitValues()?.recurrenceLines).toEqual([
      'RRULE:FREQ=WEEKLY;COUNT=3',
    ]);

    // Moved to Friday, the series keeps the Thursday the editor shows.
    controller.setStart('2026-10-02T18:00');
    controller.setField('end', '2026-10-02T18:30');
    expect(controller.submitValues()?.recurrenceLines).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=3',
    ]);
  });

  it('converts UNTIL when changing a timed event to all-day', () => {
    const controller = controllerFor(
      {
        ...recurringValue,
        recurrenceLines: ['RRULE:FREQ=DAILY;UNTIL=20261231T180000Z'],
      },
      { isEdit: true }
    );
    controller.setAllDay(true);
    expect(controller.submitValues()?.recurrenceLines).toEqual([
      'RRULE:FREQ=DAILY;UNTIL=20261231',
    ]);
  });

  it('uses the new original rule after replacing external values', () => {
    const controller = controllerFor(recurringValue, { isEdit: true });
    controller.changeRecurrenceChoice('daily');
    const nextRule = 'RRULE:INTERVAL=1;FREQ=DAILY;UNTIL=20261231T180000Z';
    controller.replaceFromExternal({
      ...controller.state(),
      recurrenceLines: [nextRule],
    });
    expect(controller.submitValues()?.recurrenceLines).toEqual([nextRule]);
  });
});

describe('pastEventWarning', () => {
  it('warns when a new event with guests already ended', () => {
    const controller = controllerFor({
      ...timedRange(-3),
      title: 'Retro',
      guests: 'guest@example.com',
    });
    expect(controller.pastEventWarning()).toBe(PAST_EVENT_GUESTS_WARNING);
  });

  it('warns once a guest is added to a past event', () => {
    const controller = controllerFor(timedRange(-3));
    expect(controller.pastEventWarning()).toBeUndefined();

    controller.setSelectedGuests([guest('guest@example.com')]);
    expect(controller.pastEventWarning()).toBe(PAST_EVENT_GUESTS_WARNING);
  });

  it('stays quiet for an upcoming event with guests', () => {
    const controller = controllerFor({
      ...timedRange(3),
      guests: 'guest@example.com',
    });
    expect(controller.pastEventWarning()).toBeUndefined();
  });

  it('stays quiet for a past event nobody is invited to', () => {
    expect(controllerFor(timedRange(-3)).pastEventWarning()).toBeUndefined();
  });

  it('stays quiet while the event is still running', () => {
    const controller = controllerFor({
      start: format(new Date(Date.now() - HOUR_MS / 2), DATETIME_VALUE),
      end: format(new Date(Date.now() + HOUR_MS), DATETIME_VALUE),
      guests: 'guest@example.com',
    });
    expect(controller.pastEventWarning()).toBeUndefined();
  });

  it('stays quiet when a finished event is edited without re-inviting', () => {
    const controller = controllerFor(
      { ...timedRange(-3), guests: 'guest@example.com' },
      { isEdit: true }
    );
    controller.setField('title', 'Retro notes');
    expect(controller.pastEventWarning()).toBeUndefined();
  });

  it('warns when a guest joins a finished event that is being edited', () => {
    const controller = controllerFor(
      { ...timedRange(-3), guests: 'guest@example.com' },
      { isEdit: true }
    );
    controller.setSelectedGuests([
      guest('guest@example.com'),
      guest('late@example.com'),
    ]);
    expect(controller.pastEventWarning()).toBe(PAST_EVENT_GUESTS_WARNING);
  });

  it('warns when an event with guests is moved into the past', () => {
    const controller = controllerFor(
      { ...timedRange(3), guests: 'guest@example.com' },
      { isEdit: true }
    );
    const past = timedRange(-3);
    controller.setStart(past.start);
    controller.setField('end', past.end);
    expect(controller.pastEventWarning()).toBe(PAST_EVENT_GUESTS_WARNING);
  });

  it('warns for an all-day event on a day that has passed', () => {
    const yesterday = format(new Date(Date.now() - 24 * HOUR_MS), 'yyyy-MM-dd');
    const today = format(new Date(), 'yyyy-MM-dd');
    const past = controllerFor({
      allDay: true,
      start: yesterday,
      end: yesterday,
      guests: 'guest@example.com',
    });
    expect(past.pastEventWarning()).toBe(PAST_EVENT_GUESTS_WARNING);

    const ongoing = controllerFor({
      allDay: true,
      start: today,
      end: today,
      guests: 'guest@example.com',
    });
    expect(ongoing.pastEventWarning()).toBeUndefined();
  });
});

describe('conferencing selection', () => {
  it('defaults new events to Macro without requesting provider conferencing', () => {
    const controller = controllerFor({ title: 'Planning' });
    expect(controller.state().conference).toBe('macro');
    expect(controller.submitValues()?.conferenceChoice).toBe('macro');
    expect(controller.submitValues()?.conference).toBeUndefined();
  });

  it('carries changes between Macro, no link, and Google Meet through submission', () => {
    const controller = controllerFor({ title: 'Planning' });
    controller.setField('conference', 'none');
    expect(controller.submitValues()?.conferenceChoice).toBe('none');
    expect(controller.submitValues()?.conference).toBeUndefined();
    controller.setField('conference', 'google_meet');
    expect(controller.submitValues()?.conferenceChoice).toBe('google_meet');
    expect(controller.submitValues()?.conference).toBe('google_meet');
    controller.setField('conference', 'macro');
    expect(controller.submitValues()?.conferenceChoice).toBe('macro');
    expect(controller.submitValues()?.conference).toBeUndefined();
  });

  it('clears existing provider conferencing when switching to Macro', () => {
    const controller = controllerFor(
      { title: 'Planning', conference: 'google_meet' },
      { isEdit: true }
    );
    controller.setField('conference', 'macro');
    expect(controller.submitValues()?.conferenceChoice).toBe('macro');
    expect(controller.submitValues()?.conference).toBe('none');
  });

  it('keeps an edited event with no meeting link opted out', () => {
    const controller = controllerFor(
      { title: 'Planning', conference: 'none' },
      { isEdit: true }
    );
    expect(controller.submitValues()?.conferenceChoice).toBe('none');
    expect(controller.submitValues()?.conference).toBeUndefined();
  });

  it('submits preselected Google Meet on new events', () => {
    const controller = controllerFor({
      title: 'Planning',
      conference: 'google_meet',
    });
    expect(controller.submitValues()?.conference).toBe('google_meet');
  });
});

const MIXED_CALENDARS = () => [
  { id: 'shared-1', label: 'Team', color: '#000000', isPrimary: false },
  { id: 'primary-1', label: 'Mine', color: '#000000', isPrimary: true },
];

describe('out of office', () => {
  it('keeps the all-day range on switch and defaults the decline mode', () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const controller = controllerFor({
      allDay: true,
      start: today,
      end: today,
      title: 'Away',
    });
    controller.setEventKind('out_of_office');

    expect(controller.isOutOfOffice()).toBe(true);
    // The switch keeps all-day; an all-day out-of-office save is encoded as a
    // full-day timed span, since Google has no date-based out-of-office event.
    expect(controller.state().allDay).toBe(true);
    expect(controller.submitValues()?.time.kind).toBe('timed');
    expect(controller.state().outOfOffice).toEqual({
      autoDeclineMode: 'decline_none',
      declineMessage: '',
    });
  });

  it('offers only primary calendars and steers the selection onto one', () => {
    const controller = controllerFor(
      { ...timedRange(3), title: 'Away', calendarId: 'shared-1' },
      { calendarOptions: MIXED_CALENDARS }
    );
    controller.setEventKind('out_of_office');

    expect(controller.calendarOptions().map((option) => option.id)).toEqual([
      'primary-1',
    ]);
    expect(controller.effectiveCalendarId()).toBe('primary-1');

    controller.setEventKind('default');
    expect(controller.effectiveCalendarId()).toBe('shared-1');
  });

  it('creates with the decline settings and without hidden fields', () => {
    const controller = controllerFor(
      {
        ...timedRange(3),
        title: 'Away',
        guests: 'guest@example.com',
        location: 'HQ',
        description: 'Send help',
        conference: 'google_meet',
      },
      { calendarOptions: MIXED_CALENDARS }
    );
    controller.setEventKind('out_of_office');
    controller.setOutOfOffice({
      autoDeclineMode: 'decline_all_conflicting_invitations',
      declineMessage: '  Back Monday  ',
    });

    const values = controller.submitValues();
    expect(values?.outOfOffice).toEqual({
      autoDeclineMode: 'decline_all_conflicting_invitations',
      declineMessage: 'Back Monday',
    });
    expect(values?.guestEmails).toEqual([]);
    expect(values?.location).toBe('');
    expect(values?.description).toBe('');
    expect(values?.conference).toBeUndefined();
    expect(values?.conferenceChoice).toBe('none');
    expect(values?.calendarId).toBe('primary-1');
  });

  it('switching back to a regular event restores the hidden fields', () => {
    const controller = controllerFor({
      ...timedRange(3),
      title: 'Sync',
      guests: 'guest@example.com',
      location: 'HQ',
    });
    controller.setEventKind('out_of_office');
    controller.setEventKind('default');

    const values = controller.submitValues();
    expect(values?.outOfOffice).toBeUndefined();
    expect(values?.guestEmails).toEqual(['guest@example.com']);
    expect(values?.location).toBe('HQ');
    expect(controller.isDirty()).toBe(false);
  });

  it('edits pass the hidden guest and location values through untouched', () => {
    const controller = controllerFor(
      {
        ...timedRange(3),
        title: 'Away',
        eventType: 'out_of_office',
        guests: 'guest@example.com',
        location: 'HQ',
      },
      { isEdit: true }
    );

    expect(controller.isDirty()).toBe(false);
    const values = controller.submitValues();
    expect(values?.guestEmails).toEqual(['guest@example.com']);
    expect(values?.location).toBe('HQ');
  });

  it('edits only patch decline settings the user actually picked', () => {
    const controller = controllerFor(
      { ...timedRange(3), title: 'Away', eventType: 'out_of_office' },
      { isEdit: true }
    );
    expect(controller.isDirty()).toBe(false);
    expect(controller.submitValues()?.outOfOffice).toBeUndefined();

    controller.setOutOfOffice({
      autoDeclineMode: 'decline_only_new_conflicting_invitations',
      declineMessage: '',
    });
    expect(controller.isDirty()).toBe(true);
    expect(controller.submitValues()?.outOfOffice).toEqual({
      autoDeclineMode: 'decline_only_new_conflicting_invitations',
    });
  });
});

it('submits guest permissions only when they change', () => {
  const controller = controllerFor(
    {
      ...timedRange(3),
      title: 'Planning',
      guestPolicy: {
        canModify: false,
        canInviteOthers: false,
        canSeeOtherGuests: true,
      },
    },
    { isEdit: true }
  );
  expect(controller.isDirty()).toBe(false);
  expect(controller.submitValues()?.guestPolicy).toBeUndefined();

  controller.setGuestPolicy({
    canModify: false,
    canInviteOthers: true,
    canSeeOtherGuests: true,
  });
  expect(controller.isDirty()).toBe(true);
  expect(controller.submitValues()?.guestPolicy).toEqual({
    canModify: false,
    canInviteOthers: true,
    canSeeOtherGuests: true,
  });

  controller.setGuestPolicy({
    canModify: false,
    canInviteOthers: false,
    canSeeOtherGuests: true,
  });
  expect(controller.isDirty()).toBe(false);
  expect(controller.submitValues()?.guestPolicy).toBeUndefined();
});

it('returns locked details to the event’s own and keeps the viewer’s reminders', () => {
  const controller = controllerFor(
    {
      start: '2030-01-01T12:00',
      end: '2030-01-01T13:00',
      title: 'Planning',
      location: 'Room 1',
      description: 'Agenda',
      recurrenceLines: ['RRULE:FREQ=DAILY'],
      reminders: { useDefault: false, overrides: [] },
    },
    { isEdit: true }
  );
  controller.setField('title', 'Planning review');
  controller.setField('location', 'Room 4');
  controller.setField('description', 'Agenda and notes');
  controller.setStart('2030-01-01T15:00');
  controller.changeRecurrenceChoice('none');
  controller.setReminderMinutes([30]);

  controller.resetDetails();

  expect(controller.submitValues()).toMatchObject({
    title: 'Planning',
    location: 'Room 1',
    description: 'Agenda',
    time: { kind: 'timed' },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 30 }],
    },
  });
  expect(controller.state().start).toBe('2030-01-01T12:00');
  expect(controller.recurrenceLines()).toEqual(['RRULE:FREQ=DAILY']);
  expect(controller.isDirty()).toBe(true);

  controller.setReminderMinutes([]);
  expect(controller.isDirty()).toBe(false);
});

it('drops guest permissions picked before switching to a calendar without them', () => {
  const google = {
    id: 'work',
    label: 'Work',
    color: '#123456',
    provider: 'google' as const,
    isPrimary: true,
    capabilities: {
      autoDecline: true,
      emailReminders: true,
      customRecurrence: true,
      removeConference: true,
      resetRsvp: true,
      guestPolicy: true,
    },
  };
  const outlook = {
    ...google,
    id: 'personal',
    label: 'Personal Outlook',
    provider: 'outlook' as const,
    capabilities: { ...google.capabilities, guestPolicy: false },
  };
  const controller = controllerFor(
    { ...timedRange(3), title: 'Planning', calendarId: 'work' },
    { calendarOptions: () => [google, outlook] }
  );
  controller.setGuestPolicy({
    canModify: true,
    canInviteOthers: true,
    canSeeOtherGuests: true,
  });
  expect(controller.submitValues()?.guestPolicy).toBeDefined();

  controller.setField('calendarId', 'personal');
  expect(controller.submitValues()?.guestPolicy).toBeUndefined();
});

it('preserves a requested conference on an unsupported calendar until the user resolves it', () => {
  const controller = controllerFor(
    { ...timedRange(3), title: 'Meeting', conference: 'google_meet' },
    {
      calendarOptions: () => [
        {
          id: 'personal',
          label: 'Personal Outlook',
          color: '#0078d4',
          provider: 'outlook',
          isPrimary: true,
          capabilities: {
            autoDecline: true,
            emailReminders: true,
            customRecurrence: false,
            removeConference: false,
            resetRsvp: false,
            guestPolicy: false,
          },
        },
      ],
    }
  );
  controller.setField('calendarId', 'personal');
  expect(controller.state().conference).toBe('google_meet');
  expect(controller.conferenceError()).toContain('cannot create');
  expect(controller.canSave()).toBe(false);
  expect(controller.submitValues()).toBeUndefined();
  controller.setField('conference', 'none');
  expect(controller.canSave()).toBe(true);
  expect(controller.submitValues()).toBeDefined();
});

it('allows unrelated edits to an existing Teams meeting on a calendar without conference creation', () => {
  const controller = controllerFor(
    {
      ...timedRange(3),
      title: 'Received meeting',
      calendarId: 'personal',
      conference: 'microsoft_teams',
    },
    {
      isEdit: true,
      calendarOptions: () => [
        {
          id: 'personal',
          label: 'Personal Outlook',
          color: '#0078d4',
          provider: 'outlook',
          isPrimary: true,
          capabilities: {
            autoDecline: true,
            emailReminders: true,
            customRecurrence: false,
            removeConference: false,
            resetRsvp: false,
            guestPolicy: false,
          },
        },
      ],
    }
  );
  controller.setField('title', 'Updated notes');
  expect(controller.conferenceError()).toBeUndefined();
  expect(controller.canSave()).toBe(true);
  expect(controller.submitValues()?.conference).toBeUndefined();
});

describe('moving the start', () => {
  const timed = {
    allDay: false,
    start: '2030-01-01T10:00',
    end: '2030-01-01T11:30',
  };

  it('carries the end along, keeping the event’s length', () => {
    const controller = controllerFor(timed);
    controller.setStart('2030-01-01T14:00');
    expect(controller.state()).toMatchObject({
      start: '2030-01-01T14:00',
      end: '2030-01-01T15:30',
    });
    controller.setStart('2030-01-02T23:00');
    expect(controller.state().end).toBe('2030-01-03T00:30');
    expect(controller.dateRangeError()).toBeUndefined();
  });

  it('leaves an end the user picked in this edit where they put it', () => {
    const controller = controllerFor(timed);
    controller.setEnd('2030-01-01T17:00');
    controller.setStart('2030-01-01T15:00');
    expect(controller.state()).toMatchObject({
      start: '2030-01-01T15:00',
      end: '2030-01-01T17:00',
    });
  });

  it('does the same for all-day dates', () => {
    const allDay = { allDay: true, start: '2030-01-01', end: '2030-01-02' };
    const following = controllerFor(allDay);
    following.setStart('2030-01-05');
    expect(following.state().end).toBe('2030-01-06');

    const picked = controllerFor(allDay);
    picked.setEnd('2030-01-04');
    picked.setStart('2030-01-03');
    expect(picked.state().end).toBe('2030-01-04');
  });

  it('follows the start again once the times are rewritten', () => {
    const toggled = controllerFor(timed);
    toggled.setEnd('2030-01-01T17:00');
    toggled.setAllDay(true);
    toggled.setStart('2030-01-03');
    expect(toggled.state()).toMatchObject({
      start: '2030-01-03',
      end: '2030-01-03',
    });

    const reset = controllerFor(timed, { isEdit: true });
    reset.setEnd('2030-01-01T17:00');
    reset.resetDetails();
    reset.setStart('2030-01-01T12:00');
    expect(reset.state().end).toBe('2030-01-01T13:30');
  });

  it('keeps the end of a range that has no length to keep', () => {
    const controller = controllerFor({
      allDay: false,
      start: '2030-01-01T12:00',
      end: '2030-01-01T09:00',
    });
    controller.setStart('2030-01-01T08:00');
    expect(controller.state().end).toBe('2030-01-01T09:00');
  });
});
