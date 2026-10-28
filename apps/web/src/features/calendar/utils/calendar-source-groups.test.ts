import { describe, expect, it } from 'vitest';
import type { CalendarSource } from '../types';
import { groupCalendarSourcesByAccount } from './calendar-source-groups';

const source = (overrides: Partial<CalendarSource>): CalendarSource => ({
  id: 'cal',
  name: 'Calendar',
  color: '#000',
  ...overrides,
});

describe('groupCalendarSourcesByAccount', () => {
  it('folds calendars into one group per account, keeping source order', () => {
    const groups = groupCalendarSourcesByAccount([
      source({ id: 'a1', emailLinkId: 'link-a', emailAddress: 'a@x.com' }),
      source({ id: 'b1', emailLinkId: 'link-b', emailAddress: 'b@x.com' }),
      source({ id: 'a2', emailLinkId: 'link-a', emailAddress: 'a@x.com' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.emailAddress).toBe('a@x.com');
    expect(groups[0]?.calendars.map((c) => c.id)).toEqual(['a1', 'a2']);
    expect(groups[1]?.emailAddress).toBe('b@x.com');
    expect(groups[1]?.calendars.map((c) => c.id)).toEqual(['b1']);
  });

  it('groups by email link even when addresses collide', () => {
    const groups = groupCalendarSourcesByAccount([
      source({
        id: 'own',
        emailLinkId: 'link-own',
        emailAddress: 'shared@x.com',
      }),
      source({
        id: 'delegated',
        emailLinkId: 'link-delegated',
        emailAddress: 'shared@x.com',
      }),
    ]);

    expect(groups.map((g) => g.key)).toEqual(['link-own', 'link-delegated']);
  });

  it('falls back to the source name for a group without an address', () => {
    const groups = groupCalendarSourcesByAccount([
      source({ id: 'calendar', name: 'Calendar' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('calendar');
    expect(groups[0]?.emailAddress).toBe('Calendar');
  });
});
