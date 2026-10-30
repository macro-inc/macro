import {
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
} from '@app/features/calendar/types';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { EventTime } from '@service-storage/generated/schemas/eventTime';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CalendarInvitation,
  invitationSchedule,
} from '../email-message/core/calendar-invitation';
import { invitationFixture } from '../email-message/core/calendar-invitation-fixtures';
import { CalendarInvitationDay } from './calendar-invitation-day';

const day = vi.hoisted(() => ({
  state: 'success' as 'loading' | 'paused' | 'success' | 'error',
  items: [] as CalendarOccurrenceItem[],
}));
vi.mock('@queries/calendar/occurrences', () => ({
  createCalendarOccurrenceQueryRange: (start: Date, end: Date) => ({
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: '2026-09-24',
    endDate: '2026-09-25',
  }),
  useCalendarOccurrencesQuery: () => ({
    get isPending() {
      return day.state === 'loading' || day.state === 'paused';
    },
    get isLoading() {
      return day.state === 'loading';
    },
    get isSuccess() {
      return day.state === 'success';
    },
    get isError() {
      return day.state === 'error';
    },
    get data() {
      if (day.state !== 'success')
        throw new Error('Unsettled resource must not be read');
      return { items: day.items, syncStatus: 'synced' };
    },
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
afterEach(() => {
  cleanup();
  day.state = 'success';
  day.items = [];
});

function occurrence(
  id: string,
  title: string,
  startsAt: string,
  endsAt: string
): CalendarOccurrenceItem {
  const time = {
    kind: 'timed' as const,
    startsAt,
    endsAt,
    timeZone: 'America/Los_Angeles',
  };
  return {
    event: {
      id,
      ownerId: 'viewer',
      icalUid: `${id}@example.com`,
      title,
      attendees: [],
      recurrenceLines: [],
      sequence: 0,
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
      eventId: id,
      occurrenceKey: startsAt,
      isCancelled: false,
      time,
    },
  };
}

const ownCopy = occurrence(
  'own-copy',
  'Product review',
  '2026-09-24T17:00:00Z',
  '2026-09-24T17:30:00Z'
);
/** The viewer's copy, moved to another time shape on the same day. */
const ownCopyAt = (time: EventTime): CalendarOccurrenceItem => ({
  event: { ...ownCopy.event, time },
  occurrence: { ...ownCopy.occurrence, time },
});
const allDayInvitation: CalendarInvitation = {
  ...invitationFixture,
  start: { kind: 'date', value: '2026-09-24' },
  end: { kind: 'date', value: '2026-09-25' },
};
const standup = occurrence(
  'standup',
  'Standup',
  '2026-09-24T16:00:00Z',
  '2026-09-24T16:15:00Z'
);

/** The invitation's time as the agenda writes it, in this machine's zone. */
const invitationTime = (invitation: CalendarInvitation) =>
  invitationSchedule(
    invitation,
    true,
    Intl.DateTimeFormat().resolvedOptions().timeZone
  ).when;

function renderDay(invitation: CalendarInvitation = invitationFixture) {
  render(() => (
    <CalendarInvitationDay
      invitation={invitation}
      eventId={ownCopy.event.id}
      occurrenceKey={ownCopy.occurrence.occurrenceKey}
      hour12
      onClose={() => {}}
    />
  ));
  return screen.getByRole('region', { name: 'Your day' });
}

describe('CalendarInvitationDay', () => {
  it('shows the invitation once, as the viewer’s copy in its time slot', () => {
    day.items = [standup, ownCopy];
    const agenda = renderDay();
    const rows = within(agenda).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Standup'),
      expect.stringContaining('Product review'),
    ]);
    expect(within(rows[1]).getByText('This invitation')).toBeTruthy();
    expect(within(agenda).getAllByText('This invitation')).toHaveLength(1);
    expect(agenda.textContent).not.toContain(invitationTime(invitationFixture));
  });

  it('keeps a newer email’s time above the day when the copy is still at its old time', () => {
    day.items = [standup, ownCopy];
    const moved: CalendarInvitation = {
      ...invitationFixture,
      start: {
        kind: 'zoned',
        value: '2026-09-24T18:00:00Z',
        time_zone: 'America/Los_Angeles',
      },
      end: {
        kind: 'zoned',
        value: '2026-09-24T18:30:00Z',
        time_zone: 'America/Los_Angeles',
      },
    };
    const agenda = renderDay(moved);
    const line = within(agenda).getByText('This invitation').closest('p');
    expect(line?.textContent).toContain(invitationTime(moved));
    const rows = within(agenda).getAllByRole('listitem');
    expect(rows[1]?.textContent).toContain('Product review');
    expect(rows[1]?.classList.contains('bg-accent-bg')).toBe(true);
    expect(within(agenda).getAllByText('This invitation')).toHaveLength(1);
  });

  it('shows an all-day invitation once, as its all-day copy', () => {
    day.items = [
      ownCopyAt({
        kind: 'allDay',
        startDate: '2026-09-24',
        endDate: '2026-09-25',
      }),
    ];
    const agenda = renderDay(allDayInvitation);
    const [row] = within(agenda).getAllByRole('listitem');
    expect(row?.textContent).toContain('All day');
    expect(within(agenda).getAllByText('This invitation')).toHaveLength(1);
    expect(row && within(row).getByText('This invitation')).toBeTruthy();
  });

  it('keeps an all-day invitation’s time above a timed copy over the same day', () => {
    day.items = [
      ownCopyAt({
        kind: 'timed',
        startsAt: new Date('2026-09-24T00:00:00').toISOString(),
        endsAt: new Date('2026-09-25T00:00:00').toISOString(),
        timeZone: 'America/Los_Angeles',
      }),
    ];
    const agenda = renderDay(allDayInvitation);
    const line = within(agenda).getByText('This invitation').closest('p');
    expect(line?.textContent).toContain(invitationTime(allDayInvitation));
    const [row] = within(agenda).getAllByRole('listitem');
    expect(row?.classList.contains('bg-accent-bg')).toBe(true);
    expect(within(agenda).getAllByText('This invitation')).toHaveLength(1);
  });

  it('keeps the invitation’s time above the day while its copy is not listed', () => {
    day.items = [standup];
    const agenda = renderDay();
    const line = within(agenda).getByText('This invitation').closest('p');
    expect(line?.textContent).toContain(invitationTime(invitationFixture));
    expect(within(agenda).getAllByRole('listitem')).toHaveLength(1);
  });

  it('waits for the day before placing the invitation', () => {
    day.state = 'loading';
    const agenda = renderDay();
    expect(within(agenda).getByRole('status').textContent).toBe(
      'Loading calendar…'
    );
    expect(within(agenda).queryByText('This invitation')).toBeNull();
  });

  it('shows the invitation’s time while the day cannot load offline', () => {
    day.state = 'paused';
    const agenda = renderDay();
    expect(
      within(agenda).getByText('This invitation').closest('p')?.textContent
    ).toContain(invitationTime(invitationFixture));
  });

  it('shows the invitation’s time when the calendar is unavailable', () => {
    day.state = 'error';
    const agenda = renderDay();
    expect(
      within(agenda).getByText('This invitation').closest('p')?.textContent
    ).toContain(invitationTime(invitationFixture));
    expect(
      within(agenda).getByText(
        'Calendar unavailable. Conflicts could not be checked.'
      )
    ).toBeTruthy();
  });
});
