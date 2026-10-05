import { describe, expect, it } from 'vitest';
import { bookingTab, bookingTimeRange, filterBookings } from './booking-list';
import type { Booking } from './types';

const now = Date.parse('2026-09-18T16:00:00Z');
function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'meeting',
    eventTypeId: 'intro',
    title: 'Introduction',
    name: 'Alex Morgan',
    email: 'alex@example.com',
    startsAt: '2026-09-18T17:00:00Z',
    endsAt: '2026-09-18T17:30:00Z',
    timeZone: 'America/New_York',
    hosts: ['host'],
    status: 'confirmed',
    location: '',
    answers: {},
    attendance: 'unknown',
    rescheduleCount: 0,
    rescheduledAt: null,
    ...overrides,
  };
}

describe('booking management', () => {
  it('keeps unconfirmed, failed, and processing requests out of upcoming meetings', () => {
    const rows = [
      booking(),
      booking({ id: 'pending', status: 'pending' }),
      booking({ id: 'failed', status: 'failed' }),
      booking({ id: 'processing', status: 'processing' }),
      booking({ id: 'cancelled', status: 'cancelled' }),
    ];
    const filter = { search: '', eventId: '' };
    expect(
      filterBookings(rows, { ...filter, tab: 'Upcoming' }, now).map((b) => b.id)
    ).toEqual(['meeting']);
    expect(
      filterBookings(rows, { ...filter, tab: 'Needs attention' }, now).map(
        (b) => b.id
      )
    ).toEqual(['failed', 'processing']);
    expect(bookingTab(rows[1], now)).toBe('Unconfirmed');
    expect(bookingTab(rows[4], now)).toBe('Cancelled');
  });

  it('keeps ongoing meetings upcoming and sorts past meetings newest first', () => {
    expect(bookingTab(booking({ startsAt: '2026-09-18T15:30:00Z' }), now)).toBe(
      'Upcoming'
    );
    const ended = booking({
      id: 'ended',
      endsAt: '2026-09-18T16:00:00Z',
      startsAt: '2026-09-18T15:30:00Z',
    });
    const earlier = booking({
      id: 'earlier',
      startsAt: '2026-09-17T17:00:00Z',
      endsAt: '2026-09-17T17:30:00Z',
    });
    expect(
      filterBookings(
        [earlier, ended],
        { tab: 'Past', search: '', eventId: '' },
        now
      ).map((b) => b.id)
    ).toEqual(['ended', 'earlier']);
  });

  it('combines event and case-insensitive guest filters without mutating data', () => {
    const rows = [booking(), booking({ id: 'other', eventTypeId: 'review' })];
    expect(
      filterBookings(
        rows,
        { tab: 'Upcoming', search: ' ALEX@EXAMPLE.COM ', eventId: 'intro' },
        now
      ).map((b) => b.id)
    ).toEqual(['meeting']);
    expect(rows.map((b) => b.id)).toEqual(['meeting', 'other']);
  });

  it('distinguishes repeated clock times across a daylight-saving transition', () => {
    const range = bookingTimeRange(
      booking({
        startsAt: '2026-11-01T05:30:00Z',
        endsAt: '2026-11-01T06:30:00Z',
      }),
      'America/New_York'
    );
    expect(range).toContain('EDT');
    expect(range).toContain('EST');
  });
});
