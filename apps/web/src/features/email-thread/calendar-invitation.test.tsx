import {
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
} from '@app/features/calendar/types';
import type { InvitationResolution } from '@service-email/generated/schemas/invitationResolution';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarInvitation } from '../email-message/core/calendar-invitation';
import { invitationFixture } from '../email-message/core/calendar-invitation-fixtures';
import { EmailCalendarInvitation } from './calendar-invitation';

const calendarUi = vi.hoisted(() => ({ enabled: true }));
const queryState = vi.hoisted(() => ({
  failed: (): boolean => false,
  data: {} as Record<string, InvitationResolution>,
  refetch: vi.fn(),
}));
vi.mock('@queries/calendar/invitations', () => ({
  useCalendarInvitationsQuery: () => ({
    isPending: false,
    get isSuccess() {
      return !queryState.failed();
    },
    get isError() {
      return queryState.failed();
    },
    get data() {
      if (queryState.failed())
        throw new Error('Failed resource must not be read');
      return queryState.data;
    },
    refetch: queryState.refetch,
  }),
  getCachedCalendarInvitations: () => queryState.data,
}));
vi.mock('@core/email-link', () => ({ useAddInboxFlow: () => vi.fn() }));
vi.mock('@core/util/url', () => ({ openExternalUrl: vi.fn() }));
vi.mock('../calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarUiFlag: () => () => calendarUi.enabled,
}));
vi.mock('../calendar/hooks/create-calendar-rsvp-controller', () => ({
  createCalendarRsvpController: () => ({
    pending: () => false,
    error: () => undefined,
    scopeOpen: () => false,
    scope: () => 'this_event',
    respond: vi.fn(),
  }),
}));
vi.mock('../calendar/components/EventRsvpScopeDialog', () => ({
  EventRsvpScopeDialog: () => null,
}));
vi.mock('./calendar-invitation-day', () => ({
  CalendarInvitationDay: (props: { invitation: CalendarInvitation }) => (
    <div data-testid="agenda-date">{props.invitation.start?.value}</div>
  ),
}));
vi.mock('@ui', async () => ({
  ...(await vi.importActual('@app/components/ui/components/Avatar')),
  ...(await vi.importActual('@app/components/ui/components/Tabs')),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
afterEach(() => {
  cleanup();
  calendarUi.enabled = true;
});

const time = {
  kind: 'timed' as const,
  startsAt: '2026-09-24T17:00:00Z',
  endsAt: '2026-09-24T17:30:00Z',
  timeZone: 'America/Los_Angeles',
};
const wire: InvitationResolution = {
  kind: 'resolved',
  can_join: true,
  can_respond: true,
  is_stale: false,
  responding_email: 'you@example.com',
  event: {
    id: 'event',
    ownerId: 'viewer',
    icalUid: invitationFixture.uid,
    title: 'Current product review',
    attendees: [
      {
        email: 'you@example.com',
        isSelf: true,
        isOptional: false,
        isOrganizer: false,
        responseStatus: 'accepted',
      },
    ],
    organizerEmail: 'alex@example.com',
    recurrenceLines: [],
    sequence: 1,
    status: 'confirmed',
    isReadOnly: false,
    guestPolicy: DEFAULT_GUEST_POLICY,
    isSnapshot: false,
    viewerCan: NO_VIEWER_CAPABILITIES,
    time,
    transparency: 'opaque',
    visibility: 'default',
    createdAt: '2026-09-19T00:00:00Z',
    updatedAt: '2026-09-19T00:00:00Z',
  },
  occurrence: {
    eventId: 'event',
    occurrenceKey: time.startsAt,
    isCancelled: false,
    time,
  },
};

describe('email invitation production host', () => {
  it('retains last-known response after refresh fails and offers recovery without stale actions', () => {
    const [failed, setFailed] = createSignal(false);
    queryState.failed = failed;
    queryState.data = { [`message:${invitationFixture.id}`]: wire };
    render(() => (
      <EmailCalendarInvitation
        threadId="thread"
        messageId="message"
        invitation={invitationFixture}
        hour12
      />
    ));
    expect(
      (screen.getByRole('radio', { name: 'Yes' }) as HTMLInputElement).checked
    ).toBe(true);
    setFailed(true);
    expect(
      screen.getByRole('heading', { name: 'Current product review' })
    ).toBeTruthy();
    expect(screen.getByText('Last response: Yes')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Yes' })).toBeNull();
    expect(
      screen.getByText(/Calendar unavailable. Showing last-known/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry calendar' }));
    expect(queryState.refetch).toHaveBeenCalled();
    setFailed(false);
    expect(
      (screen.getByRole('radio', { name: 'Yes' }) as HTMLInputElement).checked
    ).toBe(true);
  });
  it.each(['counter', 'request'] as const)(
    'opens the displayed proposal or newer snapshot day for %s',
    (method) => {
      queryState.failed = () => false;
      queryState.data = {
        [`message:${invitationFixture.id}`]: {
          ...wire,
          is_stale: method === 'request',
        },
      };
      const proposal: CalendarInvitation = {
        ...invitationFixture,
        method,
        start: {
          kind: 'zoned',
          value: '2026-09-25T17:00:00Z',
          time_zone: 'America/Los_Angeles',
        },
      };
      render(() => (
        <EmailCalendarInvitation
          threadId="thread"
          messageId="message"
          invitation={proposal}
          hour12
        />
      ));
      fireEvent.click(screen.getByRole('button', { name: 'View your day' }));
      expect(screen.getByTestId('agenda-date').textContent).toBe(
        '2026-09-25T17:00:00Z'
      );
    }
  );
});

it('shows the saved invitation without calendar state when the calendar UI is off', () => {
  calendarUi.enabled = false;
  render(() => (
    <EmailCalendarInvitation
      threadId="thread"
      messageId="message"
      invitation={invitationFixture}
      hour12
    />
  ));
  expect(screen.queryByText(/Calendar unavailable/)).toBeNull();
  expect(screen.getByText(/Saved invitation/)).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Your response' })).toBeNull();
});

it('leaves before opening the calendar so a dialog around the card can close first', () => {
  queryState.failed = () => false;
  queryState.data = { [`message:${invitationFixture.id}`]: wire };
  const order: string[] = [];
  render(() => (
    <EmailCalendarInvitation
      threadId="thread"
      messageId="message"
      invitation={invitationFixture}
      hour12
      openCalendar={(target) => order.push(`open ${target.eventId}`)}
      onNavigate={() => order.push('leave')}
    />
  ));
  // The mocked Button forwards `label` as an attribute, not an accessible name.
  const open = document.querySelector('button[label="Open in calendar"]');
  if (!open) throw new Error('Open in calendar is missing');
  fireEvent.click(open);
  expect(order).toEqual(['leave', 'open event']);
});

it('asks for a new split when Open in calendar is shift-clicked', () => {
  queryState.failed = () => false;
  queryState.data = { [`message:${invitationFixture.id}`]: wire };
  const opened: (boolean | undefined)[] = [];
  render(() => (
    <EmailCalendarInvitation
      threadId="thread"
      messageId="message"
      invitation={invitationFixture}
      hour12
      openCalendar={(target) => opened.push(target.openInNewSplit)}
    />
  ));
  const open = document.querySelector('button[label="Open in calendar"]');
  if (!open) throw new Error('Open in calendar is missing');
  fireEvent.click(open);
  fireEvent.click(open, { shiftKey: true });
  expect(opened).toEqual([false, true]);
});
