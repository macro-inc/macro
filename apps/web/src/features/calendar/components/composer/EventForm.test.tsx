/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, createMemo } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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

import { createCalendarEventFormController } from './create-calendar-event-form-controller';
import { EventForm } from './EventForm';
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
function showForm(props: Partial<ComponentProps<typeof EventForm>> = {}) {
  const edits = { count: 0 };
  render(() => {
    const calendarOptions = createMemo(() => [WORK_CALENDAR]);
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
        calendarId: WORK_CALENDAR.id,
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

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', ObserverStub);
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.stubGlobal('scrollTo', vi.fn() as unknown as typeof window.scrollTo);
});
afterEach(() => {
  cleanup();
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
  expect(screen.getByRole('button', { name: 'Location' })).toHaveProperty(
    'disabled',
    true
  );
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

  await user.click(screen.getByRole('button', { name: /Notifications/ }));
  expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
});

it('lets the organizer set guest permissions, with modifying implying inviting', async () => {
  const user = userEvent.setup();
  showForm({ guestPolicyEditable: true });

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

it('offers no guest permissions without the organizer’s rights', () => {
  showForm();

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

it('moves the end with the start until the end is picked', async () => {
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
  expect(end().value).toBe('5:00 PM');
  expect(
    screen.queryByText('End time must be after the start time.')
  ).toBeNull();
});
