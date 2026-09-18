import {
  type CalendarEvent,
  DEFAULT_CALENDAR_SOURCE,
} from '@app/features/calendar/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type JSX, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventRsvpSection } from './EventRsvpSection';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('@queries/calendar/mutations', () => ({
  useRsvpCalendarEventMutation: () => ({ mutate }),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={props.onClick}>{props.children}</button>
  ),
}));
vi.mock('./EventRsvpScopeDialog', () => ({
  EventRsvpScopeDialog: (props: {
    open: boolean;
    scope: string;
    onScopeChange: (value: string) => void;
    onClose: () => void;
    onConfirm: () => void;
  }) => (
    <Show when={props.open}>
      <div role="dialog">
        <span>{props.scope}</span>
        <button onClick={() => props.onScopeChange('all')}>All events</button>
        <button onClick={props.onClose}>Cancel</button>
        <button onClick={props.onConfirm}>Save response</button>
      </div>
    </Show>
  ),
}));
afterEach(cleanup);
beforeEach(() => mutate.mockClear());
const event: CalendarEvent = {
  id: 'occurrence',
  eventId: 'event',
  occurrenceKey: '2026-09-11',
  recurrenceId: 'instance',
  isCancelled: false,
  isReadOnly: false,
  sourceCalendarIds: [],
  recurrenceLines: ['RRULE:FREQ=WEEKLY'],
  title: 'Team meeting',
  start: '2026-09-11T13:00:00Z',
  end: '2026-09-11T13:30:00Z',
  allDay: false,
  calendar: DEFAULT_CALENDAR_SOURCE,
  visibleCalendars: [],
  attendees: [
    {
      email: 'self@example.com',
      isSelf: true,
      isOrganizer: false,
      isOptional: false,
      responseStatus: 'accepted',
    },
  ],
};
describe('event RSVP confirmation', () => {
  it('cancels without submitting and resets the scope on the next response', () => {
    render(() => <EventRsvpSection event={event} />);
    fireEvent.click(screen.getByText('Yes'));
    fireEvent.click(screen.getByText('All events'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Maybe'));
    expect(screen.getByText('this_event')).toBeTruthy();
    fireEvent.click(screen.getByText('Save response'));
    expect(mutate).toHaveBeenCalledExactlyOnceWith({
      eventId: 'event',
      response: 'tentative',
      scope: 'this_event',
      recurrenceId: 'instance',
      occurrenceKey: '2026-09-11',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('applies a confirmed series response without occurrence identifiers', () => {
    render(() => <EventRsvpSection event={event} />);
    fireEvent.click(screen.getByText('No'));
    fireEvent.click(screen.getByText('All events'));
    fireEvent.click(screen.getByText('Save response'));
    expect(mutate).toHaveBeenCalledExactlyOnceWith({
      eventId: 'event',
      response: 'declined',
      scope: 'all',
      recurrenceId: undefined,
      occurrenceKey: undefined,
    });
  });
  it('submits non-recurring events without opening a scope prompt', () => {
    render(() => (
      <EventRsvpSection
        event={{ ...event, recurrenceLines: [], recurrenceId: undefined }}
      />
    ));
    fireEvent.click(screen.getByText('Yes'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mutate).toHaveBeenCalledOnce();
  });
});
