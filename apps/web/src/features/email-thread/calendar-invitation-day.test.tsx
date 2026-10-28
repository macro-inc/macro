import {
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
} from '@app/features/calendar/types';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invitationFixture } from '../email-message/core/calendar-invitation-fixtures';
import { CalendarInvitationDay } from './calendar-invitation-day';

const day = vi.hoisted(() => ({
  state: 'success' as 'pending' | 'success' | 'error',
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
      return day.state === 'pending';
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
const standup = occurrence(
  'standup',
  'Standup',
  '2026-09-24T16:00:00Z',
  '2026-09-24T16:15:00Z'
);

function renderDay() {
  render(() => (
    <CalendarInvitationDay
      invitation={invitationFixture}
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
    expect(within(agenda).queryByText(/Sep 24, 2026/)).toBeNull();
  });

  it('keeps the invitation’s time above the day while its copy is not listed', () => {
    day.items = [standup];
    const agenda = renderDay();
    const line = within(agenda).getByText('This invitation').closest('p');
    expect(line?.textContent).toMatch(/Sep 24, 2026/);
    expect(within(agenda).getAllByRole('listitem')).toHaveLength(1);
  });

  it('waits for the day before placing the invitation', () => {
    day.state = 'pending';
    const agenda = renderDay();
    expect(within(agenda).getByRole('status').textContent).toBe(
      'Loading calendar…'
    );
    expect(within(agenda).queryByText('This invitation')).toBeNull();
  });

  it('shows the invitation’s time when the calendar is unavailable', () => {
    day.state = 'error';
    const agenda = renderDay();
    expect(
      within(agenda).getByText('This invitation').closest('p')?.textContent
    ).toMatch(/Sep 24, 2026/);
    expect(
      within(agenda).getByText(
        'Calendar unavailable. Conflicts could not be checked.'
      )
    ).toBeTruthy();
  });
});
