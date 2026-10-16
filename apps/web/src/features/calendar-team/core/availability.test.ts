import { describe, expect, it } from 'vitest';
import { availabilitySources } from './availability';

const calendar = (calendarId: string, name = calendarId) => ({
  calendarId,
  name,
  isPrimary: false,
  contributesToAvailability: false,
});

describe('availabilitySources', () => {
  it('keeps source order, colors, and accounts for countable calendars', () => {
    const primary = {
      id: 'primary',
      name: 'gab@macro.com',
      color: 'red',
      emailAddress: 'gab@macro.com',
      emailLinkId: 'link',
      isPrimary: true,
    };
    const holidays = {
      id: 'holidays',
      name: 'Holidays',
      color: 'green',
      emailAddress: 'gab@macro.com',
      emailLinkId: 'link',
      isSubscription: true,
    };
    const hidden = { id: 'not-countable', name: 'Other', color: 'blue' };
    expect(
      availabilitySources(
        [primary, hidden, holidays],
        [calendar('holidays'), calendar('primary')]
      )
    ).toEqual([primary, holidays]);
  });

  it('still lists a countable calendar the source list has not loaded', () => {
    expect(availabilitySources([], [calendar('new', 'New calendar')])).toEqual([
      {
        id: 'new',
        name: 'New calendar',
        color: 'var(--color-accent)',
        isPrimary: false,
      },
    ]);
  });
});
