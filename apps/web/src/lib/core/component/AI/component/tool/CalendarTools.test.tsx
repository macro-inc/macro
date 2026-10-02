import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Component, JSX, ParentProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createCalendarEventHandler,
  createConfirmedCalendarEventHandler,
} from './CalendarTools';

const openToolCalendarEvent = vi.hoisted(() => vi.fn());
vi.mock('./calendar/open-tool-event', () => ({
  openToolCalendarEvent,
  toolInputOpenTime: vi.fn(),
}));
vi.mock('./calendar/ChatCompose', () => ({
  CalendarChatCompose: () => <div>calendar composer</div>,
}));
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type="button"
      onClick={props.onClick}
      aria-expanded={props['aria-expanded']}
    >
      {props.children}
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const handlers = {
  CreateCalendarEvent: createCalendarEventHandler,
  CreateConfirmedCalendarEvent: createConfirmedCalendarEventHandler,
};

const draft = {
  title: 'Board sync',
  time: {
    kind: 'timed',
    startsAt: '2026-10-05T14:00:00Z',
    endsAt: '2026-10-05T15:00:00Z',
    timeZone: 'America/New_York',
  },
  attendees: [{ email: 'guest@example.com' }],
};

const createdEvent = {
  eventId: '01992d2f-8444-7000-8000-000000000001',
  title: 'Board sync',
  start: '2026-10-05T14:00:00Z',
  end: '2026-10-05T15:00:00Z',
  isAllDay: false,
  timeZone: 'America/New_York',
  location: null,
  description: null,
  status: 'confirmed',
  isRecurring: false,
  recurrenceLines: [],
  attendees: [
    {
      email: 'guest@example.com',
      responseStatus: 'needs_action',
      isOrganizer: false,
      isOptional: false,
    },
  ],
  attendeeCount: 1,
  organizerEmail: 'me@example.com',
  conferenceUrl: null,
  isReadOnly: false,
  calendarId: null,
};

function tool(name: keyof typeof handlers, data: unknown, response?: unknown) {
  return render(() => (
    <Dynamic
      component={handlers[name].render as Component<Record<string, unknown>>}
      tool={{ id: 'call-1', name, data }}
      response={response === undefined ? undefined : { name, data: response }}
      renderContext={{ isStreaming: response === undefined, grouped: false }}
      chat_id="chat-1"
      message_id="message-1"
    />
  ));
}

it('shows a confirmed create in flight as the plain create card', () => {
  tool('CreateConfirmedCalendarEvent', {
    ...draft,
    userConfirmation: 'yes, go ahead',
  });
  expect(screen.getByText('Create calendar event')).toBeTruthy();
  expect(screen.getByText('Board sync')).toBeTruthy();
  expect(screen.queryByText('calendar composer')).toBeNull();
});

it('renders the created event directly, with no composer or pending state', () => {
  tool(
    'CreateConfirmedCalendarEvent',
    { ...draft, userConfirmation: 'yes, go ahead' },
    createdEvent
  );
  expect(screen.getByText('Done')).toBeTruthy();
  expect(screen.queryByText('calendar composer')).toBeNull();

  fireEvent.click(screen.getByRole('button', { expanded: false }));
  expect(screen.getByText('1 attendee: guest@example.com')).toBeTruthy();

  fireEvent.click(screen.getByText('Board sync', { selector: 'span.text-xs' }));
  expect(openToolCalendarEvent).toHaveBeenCalledWith(
    createdEvent,
    expect.objectContaining({})
  );
});

it('still defers the plain create to the composer', () => {
  tool('CreateCalendarEvent', draft, 'PendingUserExecution');
  expect(screen.getByText('calendar composer')).toBeTruthy();
});
