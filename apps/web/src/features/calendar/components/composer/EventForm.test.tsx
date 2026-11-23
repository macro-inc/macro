/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { type Accessor, type ComponentProps, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const calendar = vi.hoisted(() => ({ syncing: (): boolean => false }));

vi.mock('@queries/calendar/first-sync', () => ({
  useCalendarFirstSync: (enabled: Accessor<boolean>) => () =>
    enabled() && calendar.syncing(),
}));

vi.mock('@components/app/split-layout/split-router/mention-links', () => ({
  useMacroMentionLinkResolver: () => () => undefined,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/MarkdownTextarea',
  () => ({ MarkdownTextarea: () => null })
);
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: () => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Search for guests');
    return input;
  },
}));

import { EventForm } from '../../views/composer/EventForm';
import { createCalendarEventFormController } from './create-calendar-event-form-controller';
import type { EventEditorCalendarOption } from './event-form-model';

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const WORK_CALENDAR: EventEditorCalendarOption = {
  id: 'work-calendar',
  provider: 'google',
  capabilities: {
    autoDecline: true,
    emailReminders: true,
    customRecurrence: false,
    removeConference: false,
    resetRsvp: false,
    guestPolicy: true,
    conferenceProvider: 'google_meet',
  },
  label: 'Work',
  color: '#123456',
  defaultReminders: [],
  isPrimary: true,
};

/** Renders the form and counts the edits it reports back to its host. */
function showForm(
  props: Partial<ComponentProps<typeof EventForm>> = {},
  calendarOptions: Accessor<EventEditorCalendarOption[]> = () => [WORK_CALENDAR]
) {
  const edits = { count: 0 };
  render(() => {
    const controller = createCalendarEventFormController({
      initialValue: {
        title: 'Customer demo',
        allDay: false,
        start: '2030-01-01T12:00',
        end: '2030-01-01T13:00',
        recurrenceLines: [],
        guests: '',
        location: '',
        description: '',
        conference: 'none',
        calendarId: calendarOptions()[0]?.id,
      },
      calendarOptions,
      guestOptions: () => [],
      onChange: () => {
        edits.count += 1;
        // An edit loop overflows the stack and takes the app down with it, so
        // fail the test instead of hanging it.
        if (edits.count > 50) throw new Error('the event form never settled');
      },
    });
    return (
      <EventForm
        controller={controller}
        macroCallsEnabled
        pending={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        {...props}
      />
    );
  });
  return edits;
}

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  // jsdom has no app CSS, so exiting menu presence needs explicit motion defaults.
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  calendar.syncing = () => false;
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', ObserverStub);
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.stubGlobal('scrollTo', vi.fn() as unknown as typeof window.scrollTo);
});

it('keeps the create draft editable until its first calendar can save it', async () => {
  const [calendars, setCalendars] = createSignal<EventEditorCalendarOption[]>(
    []
  );
  calendar.syncing = () => true;
  const onSubmit = vi.fn();
  showForm({ onSubmit }, calendars);

  expect(screen.getByRole('status').textContent).toBe('Syncing your calendar…');
  expect(screen.queryByRole('button', { name: /^Calendar$/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create event' })).toBeNull();
  const title = screen.getByRole('textbox', {
    name: 'Title',
  }) as HTMLInputElement;
  fireEvent.submit(title.form!);
  expect(onSubmit).not.toHaveBeenCalled();
  await userEvent.setup().type(title, ' revised');

  setCalendars([WORK_CALENDAR]);

  expect(title.value).toBe('Customer demo revised');
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Create event' }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Customer demo revised',
      calendarId: WORK_CALENDAR.id,
    }),
    undefined
  );
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

it('settles after a typed title instead of editing itself', async () => {
  const user = userEvent.setup();
  const edits = showForm();
  await user.type(screen.getByLabelText('Title'), 'ab');
  expect(screen.getByLabelText('Title')).toHaveProperty(
    'value',
    'Customer demoab'
  );
  expect(edits.count).toBeLessThan(10);
});

it('settles after a Macro call is picked', async () => {
  const user = userEvent.setup();
  const edits = showForm();
  const trigger = screen.getByRole('button', { name: /Video conferencing/ });
  await user.click(trigger);
  await user.click(screen.getByRole('option', { name: 'Macro call' }));
  expect(trigger.textContent).toContain('Macro call');
  expect(edits.count).toBeLessThan(10);
});

it('changes duration and all-day mode through the same form state', async () => {
  const user = userEvent.setup();
  showForm();

  await user.click(screen.getByRole('button', { name: 'Duration' }));
  await user.click(screen.getByRole('menuitemradio', { name: '1h 30min' }));
  expect(
    await screen.findByRole('combobox', { name: 'event end time' })
  ).toHaveProperty('value', '1:30 PM');

  await user.click(screen.getByRole('button', { name: 'Duration' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'All day' }));
  await screen.findByRole('button', { name: 'Duration' });
  expect(
    screen.queryByRole('combobox', { name: 'event start time' })
  ).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Duration' }));
  await user.click(screen.getByRole('menuitemradio', { name: '30min' }));
  expect(
    await screen.findByRole('combobox', { name: 'event start time' })
  ).toHaveProperty('value', '1:00 AM');
  expect(
    screen.getByRole('combobox', { name: 'event end time' })
  ).toHaveProperty('value', '1:30 AM');
});

it('keeps a guest the organizer does not let modify to their own reminders', async () => {
  const user = userEvent.setup();
  showForm({
    isEdit: true,
    disabledFields: {
      calendar: true,
      title: true,
      allDay: true,
      start: true,
      end: true,
      recurrence: true,
      location: true,
      description: true,
      conference: true,
    },
    detailsReadOnlyReason: 'Only the organizer can change this event.',
  });

  await user.type(screen.getByLabelText('Title'), 'ab');
  expect(screen.getByLabelText('Title')).toHaveProperty(
    'value',
    'Customer demo'
  );
  expect(screen.getByLabelText('Location')).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('Repeats')).toHaveProperty('disabled', true);
  expect(
    screen.getByRole('button', { name: /Video conferencing/ })
  ).toHaveProperty('disabled', true);
  // Read-only on every edit, the kind and calendar no longer open their one
  // value as a list once the details are locked.
  for (const name of ['Event kind', 'Calendar']) {
    const pill = screen.getByLabelText(name);
    expect(pill).toHaveProperty('disabled', true);
    await user.click(pill);
    expect(screen.queryByRole('listbox')).toBeNull();
  }
  expect(
    screen.getByText('Only the organizer can change this event.')
  ).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'More options' }));
  await user.click(screen.getByRole('button', { name: /Notifications/ }));
  expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
});

it('lets the organizer set guest permissions, with modifying implying inviting', async () => {
  const user = userEvent.setup();
  showForm({ guestPolicyEditable: true });
  await user.click(screen.getByRole('button', { name: 'More options' }));

  const permissions = screen.getByRole('group', { name: 'Guest permissions' });
  const modify = screen.getByRole('checkbox', { name: 'Modify event' });
  const invite = screen.getByRole('checkbox', { name: 'Invite others' });
  const seeGuests = screen.getByRole('checkbox', { name: 'See guest list' });
  expect(permissions).toBeTruthy();
  expect([
    (modify as HTMLInputElement).checked,
    (invite as HTMLInputElement).checked,
    (seeGuests as HTMLInputElement).checked,
  ]).toEqual([false, true, true]);

  await user.click(invite);
  expect((invite as HTMLInputElement).checked).toBe(false);
  await user.click(modify);
  expect((modify as HTMLInputElement).checked).toBe(true);
  expect((invite as HTMLInputElement).checked).toBe(true);
  expect((invite as HTMLInputElement).disabled).toBe(true);
});

it('offers no guest permissions without the organizer’s rights', async () => {
  const user = userEvent.setup();
  showForm();
  await user.click(screen.getByRole('button', { name: 'More options' }));

  expect(screen.queryByRole('group', { name: 'Guest permissions' })).toBeNull();
});

it('describes the read-only repeat rule while an edit targets one occurrence', async () => {
  const user = userEvent.setup();
  showForm({ isEdit: true, showRecurringEditNotice: true });
  const repeats = screen.getByLabelText('Repeats');
  expect(repeats.getAttribute('aria-describedby')).toBeNull();

  await user.click(screen.getByRole('radio', { name: 'This event' }));
  expect(repeats.getAttribute('aria-readonly')).toBe('true');
  const reasonId = repeats.getAttribute('aria-describedby');
  expect(reasonId && document.getElementById(reasonId)).toBeTruthy();

  await user.click(screen.getByRole('radio', { name: 'All events' }));
  expect(repeats.getAttribute('aria-describedby')).toBeNull();
  expect(reasonId && document.getElementById(reasonId)).toBeNull();
});

it('returns guest permissions to the stored ones when an edit targets one occurrence', async () => {
  const user = userEvent.setup();
  showForm({
    isEdit: true,
    guestPolicyEditable: true,
    showRecurringEditNotice: true,
  });
  await user.click(screen.getByRole('button', { name: 'More options' }));
  const seeGuests = screen.getByRole('checkbox', { name: 'See guest list' });

  await user.click(seeGuests);
  expect((seeGuests as HTMLInputElement).checked).toBe(false);
  await user.click(screen.getByRole('radio', { name: 'This event' }));

  expect((seeGuests as HTMLInputElement).checked).toBe(true);
  expect((seeGuests as HTMLInputElement).disabled).toBe(true);
  expect(
    screen.getByRole('group', {
      name: 'Guest permissions',
      description:
        'Guest permissions apply to all events. Choose All events to change them.',
    })
  ).toBeTruthy();

  await user.click(screen.getByRole('radio', { name: 'All events' }));
  expect((seeGuests as HTMLInputElement).disabled).toBe(false);
  expect(
    screen.queryByText(
      'Guest permissions apply to all events. Choose All events to change them.'
    )
  ).toBeNull();
});

it('moves the end with the start even after the end is picked', async () => {
  const user = userEvent.setup();
  showForm();
  const start = () =>
    screen.getByRole<HTMLInputElement>('combobox', {
      name: 'event start time',
    });
  const end = () =>
    screen.getByRole<HTMLInputElement>('combobox', { name: 'event end time' });
  const typeTime = async (field: HTMLElement, time: string) => {
    await user.click(field);
    await user.keyboard(`${time}{Enter}`);
  };

  await typeTime(start(), '14:00');
  expect(start().value).toBe('2:00 PM');
  expect(end().value).toBe('3:00 PM');

  await typeTime(end(), '17:00');
  await typeTime(start(), '15:00');
  expect(end().value).toBe('6:00 PM');
  expect(
    screen.queryByText('End time must be after the start time.')
  ).toBeNull();
});

it('shows and lists times on the calendar’s 24-hour clock', async () => {
  const user = userEvent.setup();
  showForm({ timeFormat: '24-hour' });
  const start = screen.getByRole<HTMLInputElement>('combobox', {
    name: 'event start time',
  });
  const end = screen.getByRole<HTMLInputElement>('combobox', {
    name: 'event end time',
  });
  expect(start.value).toBe('12:00');
  expect(end.value).toBe('13:00');

  await user.click(start);
  expect(screen.getByRole('option', { name: /^14:00/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /PM/ })).toBeNull();
  await user.keyboard('3p{Enter}');
  expect(start.value).toBe('15:00');
  expect(end.value).toBe('16:00');

  await user.click(end);
  expect(screen.getByRole('option', { name: /^16:15.*15min/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /PM/ })).toBeNull();
});

it('keeps a 12-hour calendar’s times on the 12-hour clock', () => {
  showForm({ timeFormat: '12-hour' });
  expect(
    screen.getByRole<HTMLInputElement>('combobox', { name: 'event start time' })
      .value
  ).toBe('12:00pm');
});

const TEAMS_REMOVAL_NOTICE =
  'Outlook can’t remove Teams from an existing event. To drop it, replace the event: guests get a new invitation with your changes and respond again.';

const OUTLOOK_CALENDAR: EventEditorCalendarOption = {
  ...WORK_CALENDAR,
  id: 'outlook-calendar',
  provider: 'outlook',
  capabilities: {
    autoDecline: true,
    emailReminders: false,
    customRecurrence: false,
    removeConference: false,
    resetRsvp: false,
    guestPolicy: false,
    conferenceProvider: 'microsoft_teams',
  },
};

const MEET_CALENDAR: EventEditorCalendarOption = {
  ...WORK_CALENDAR,
  capabilities: {
    autoDecline: true,
    emailReminders: true,
    customRecurrence: false,
    removeConference: true,
    resetRsvp: false,
    guestPolicy: true,
    conferenceProvider: 'google_meet',
  },
};

/** Opens the editor of a saved event that holds the calendar's own meeting. */
function showMeetingEdit(
  calendarOption: EventEditorCalendarOption,
  props: Partial<ComponentProps<typeof EventForm>> = {}
) {
  render(() => {
    const controller = createCalendarEventFormController({
      initialValue: {
        title: 'Customer demo',
        allDay: false,
        start: '2030-01-01T12:00',
        end: '2030-01-01T13:00',
        recurrenceLines: [],
        guests: '',
        location: '',
        description: '',
        conference:
          calendarOption.capabilities?.conferenceProvider === 'google_meet'
            ? 'google_meet'
            : 'microsoft_teams',
        calendarId: calendarOption.id,
      },
      isEdit: true,
      calendarOptions: () => [calendarOption],
      guestOptions: () => [],
    });
    return (
      <EventForm
        controller={controller}
        macroCallsEnabled
        isEdit
        disabledFields={{ calendar: true }}
        pending={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        {...props}
      />
    );
  });
}

async function turnOffMeeting(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Video conferencing/ }));
  await user.click(screen.getByRole('option', { name: 'No meeting link' }));
}

it('turning Teams off on an Outlook event asks for a replacement until Undo brings it back', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  showMeetingEdit(OUTLOOK_CALENDAR, { onSubmit, onReplace: vi.fn() });
  const save = screen.getByRole('button', { name: 'Save' });
  expect((save as HTMLButtonElement).disabled).toBe(false);

  await user.click(screen.getByRole('button', { name: /Video conferencing/ }));
  expect(screen.queryByRole('option', { name: 'Macro call' })).toBeNull();
  await user.click(screen.getByRole('option', { name: 'No meeting link' }));

  expect(screen.getByText(TEAMS_REMOVAL_NOTICE)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: /Video conferencing/ }).textContent
  ).toContain('No meeting link');
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(save.closest('form')!);
  expect(onSubmit).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Undo' }));

  expect(screen.queryByText(TEAMS_REMOVAL_NOTICE)).toBeNull();
  expect(
    screen.getByRole('button', { name: /Video conferencing/ }).textContent
  ).toContain('Microsoft Teams');
  expect((save as HTMLButtonElement).disabled).toBe(false);
  await user.click(save);
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it('Replace event… hands the form’s unsaved edits to the host instead of saving', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  const onReplace = vi.fn();
  showMeetingEdit(OUTLOOK_CALENDAR, { onSubmit, onReplace });

  await user.type(screen.getByRole('textbox', { name: 'Title' }), ' moved');
  await turnOffMeeting(user);
  await user.click(screen.getByRole('button', { name: 'Replace event…' }));

  expect(onReplace).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Customer demo moved',
      conferenceChoice: 'none',
    }),
    undefined
  );
  expect(onSubmit).not.toHaveBeenCalled();
});

it('keeps Teams locked where the host cannot replace the event', () => {
  showMeetingEdit(OUTLOOK_CALENDAR);

  expect(
    (
      screen.getByRole('button', {
        name: /Video conferencing/,
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});

it('removing Google Meet stays an ordinary save with no notice', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  showMeetingEdit(MEET_CALENDAR, { onSubmit, onReplace: vi.fn() });

  await turnOffMeeting(user);

  expect(screen.queryByText(TEAMS_REMOVAL_NOTICE)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ conference: 'none' }),
    undefined
  );
});
