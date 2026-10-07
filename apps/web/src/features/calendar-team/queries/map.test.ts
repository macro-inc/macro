import type { TeamCalendarItem } from '@service-storage/generated/schemas/teamCalendarItem';
import { describe, expect, it } from 'vitest';
import { canEditCalendarEventTime } from '../../calendar/utils/event-interaction';
import { mapTeamCalendarItem } from './map';

const busy = {
  id: 'opaque',
  ownerId: 'alice',
  kind: 'busy',
  contributesToAvailability: true,
  time: {
    kind: 'timed',
    startsAt: '2026-10-07T12:00:00Z',
    endsAt: '2026-10-07T13:00:00Z',
    timeZone: null,
  },
} satisfies TeamCalendarItem;

describe('team calendar grid projection', () => {
  it('keeps redacted blocks separate from canonical event identities and provider actions', () => {
    const event = mapTeamCalendarItem(busy, 'Alice');
    expect(event.id).toBe(JSON.stringify(['team-calendar', 'alice', 'opaque']));
    expect(event.isReadOnly).toBe(true);
    expect(event.calendarId).toBeUndefined();
    expect(event.title).toBe('Alice: Busy');
    expect(event.attendees).toEqual([]);
    expect(event.description).toBeUndefined();
    expect(event.conferenceUrl).toBeUndefined();
    expect(event.eventType).toBeUndefined();
    expect(canEditCalendarEventTime({ ...event, isReadOnly: false })).toBe(
      false
    );
  });

  it('does not describe a followed calendar as the sharer being busy', () => {
    const event = mapTeamCalendarItem(
      { ...busy, contributesToAvailability: false },
      'Alice'
    );
    expect(event.title).toBe('Alice: Shared calendar block');
    expect(event.teamProjection?.contributesToAvailability).toBe(false);
  });

  it('does not let another sharer overwrite the first sharer', () => {
    expect(mapTeamCalendarItem(busy, 'Alice').id).not.toBe(
      mapTeamCalendarItem({ ...busy, ownerId: 'bob' }, 'Bob').id
    );
  });

  it('ignores any accidental detail fields on the busy variant', () => {
    const withUnexpectedDetails = {
      ...busy,
      details: {
        title: 'Secret',
        attendees: [],
        description: 'Hidden body',
        conferenceUrl: 'https://example.com',
      },
    };
    const event = mapTeamCalendarItem(withUnexpectedDetails, 'Alice');
    expect(event.title).toBe('Alice: Busy');
    expect(event.description).toBeUndefined();
    expect(event.conferenceUrl).toBeUndefined();
  });
});
