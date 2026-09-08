import type { CalendarEventSourceContent } from '@service-storage/generated/schemas/calendarEventSourceContent';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { describe, expect, it } from 'vitest';
import {
  type CalendarEvent,
  type CalendarSource,
  isCalendarEventVisible,
  mapCalendarEventToFullCalendar,
  mapCalendarOccurrenceChips,
} from './types';

const PRIMARY: CalendarSource = {
  id: 'primary',
  name: 'teo@example.com',
  color: 'blue',
  isPrimary: true,
};
const SHARED: CalendarSource = {
  id: 'shared',
  name: 'Macro Vacation',
  color: 'orange',
};
const sourceById = new Map([
  [PRIMARY.id, PRIMARY],
  [SHARED.id, SHARED],
]);

function copy(
  calendarId: string,
  overrides: Partial<CalendarEventSourceContent> = {}
): CalendarEventSourceContent {
  return {
    calendarId,
    title: 'OOO',
    eventType: 'out_of_office',
    visibility: 'private',
    transparency: 'opaque',
    isReadOnly: false,
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 30 }],
    },
    creatorEmail: 'teo@example.com',
    ...overrides,
  };
}

const sharedCopy = copy('shared', {
  title: '[teo] OOO',
  eventType: 'default',
  isReadOnly: true,
  transparency: 'transparent',
  reminders: { useDefault: false, overrides: [] },
  creatorEmail: 'script@example.com',
});

function item(sources: CalendarEventSourceContent[]): CalendarOccurrenceItem {
  return {
    event: {
      id: 'event',
      ownerId: 'macro|teo@example.com',
      icalUid: 'uid',
      calendarId: sources[0]?.calendarId,
      sources,
      title: 'OOO',
      status: 'confirmed',
      visibility: 'private',
      transparency: 'opaque',
      eventType: 'out_of_office',
      time: {
        kind: 'timed',
        startsAt: '2026-09-10T13:00:00Z',
        endsAt: '2026-09-10T14:00:00Z',
      },
      recurrenceLines: [],
      sequence: 0,
      isReadOnly: false,
      attendees: [],
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    },
    occurrence: {
      eventId: 'event',
      occurrenceKey: '2026-09-10T13:00:00+00:00',
      time: {
        kind: 'timed',
        startsAt: '2026-09-10T13:00:00Z',
        endsAt: '2026-09-10T14:00:00Z',
      },
      isCancelled: false,
    },
  };
}

const hidden = (...ids: string[]) => {
  const set = new Set(ids);
  return (id: string) => !set.has(id);
};

describe('mapCalendarOccurrenceChips', () => {
  it('renders one chip per calendar copy, each with its own content', () => {
    const [primary, shared] = mapCalendarOccurrenceChips(
      item([copy('primary'), sharedCopy]),
      { sourceById }
    );

    expect(primary.calendar).toBe(PRIMARY);
    expect(primary.calendarId).toBe('primary');
    expect(primary.title).toBe('OOO');
    expect(primary.eventType).toBe('out_of_office');
    expect(primary.isReadOnly).toBe(false);
    expect(primary.creatorEmail).toBe('teo@example.com');
    expect(primary.sourceCalendarIds).toEqual(['primary']);
    expect(shared.calendar).toBe(SHARED);
    expect(shared.calendarId).toBe('shared');
    expect(shared.title).toBe('[teo] OOO');
    expect(shared.eventType).toBe('default');
    expect(shared.isReadOnly).toBe(true);
    expect(shared.creatorEmail).toBe('script@example.com');
    expect(shared.sourceCalendarIds).toEqual(['shared']);
  });

  it('gives each copy its own identity on the shared occurrence', () => {
    const [primary, shared] = mapCalendarOccurrenceChips(
      item([copy('primary'), sharedCopy]),
      { sourceById }
    );

    expect(JSON.parse(primary.id)).toEqual([
      'event',
      '2026-09-10T13:00:00+00:00',
      'primary',
    ]);
    expect(JSON.parse(shared.id)).toEqual([
      'event',
      '2026-09-10T13:00:00+00:00',
      'shared',
    ]);
    expect(shared.eventId).toBe(primary.eventId);
    expect(shared.occurrenceKey).toBe(primary.occurrenceKey);
  });

  it('keeps the reminders that fire on the primary copy on every chip', () => {
    const chips = mapCalendarOccurrenceChips(
      item([copy('primary'), sharedCopy]),
      { sourceById }
    );

    for (const chip of chips) {
      expect(chip.reminders?.overrides).toEqual([
        { method: 'popup', minutes: 30 },
      ]);
      expect(chip.reminderCalendarId).toBe('primary');
      expect(chip.reminderEventType).toBe('out_of_office');
    }
  });

  it('renders a single-copy event as one chip with the plain occurrence id', () => {
    const chips = mapCalendarOccurrenceChips(item([copy('primary')]), {
      sourceById,
    });

    expect(chips).toHaveLength(1);
    expect(chips[0].id).toBe('["event","2026-09-10T13:00:00+00:00"]');
    expect(chips[0].sourceCalendarIds).toEqual(['primary']);
  });

  it('reads the entity when no copy data is present', () => {
    const [event] = mapCalendarOccurrenceChips(item([]), { sourceById });

    expect(event.title).toBe('OOO');
    expect(event.calendarId).toBeUndefined();
    expect(event.reminderEventType).toBe('out_of_office');
    expect(event.sourceCalendarIds).toEqual([]);
  });
});

describe('isCalendarEventVisible', () => {
  const merged = {
    calendar: SHARED,
    sourceCalendarIds: ['primary', 'shared'],
  } satisfies Pick<CalendarEvent, 'calendar' | 'sourceCalendarIds'>;

  it('stays visible while any of its calendars is shown', () => {
    expect(isCalendarEventVisible(merged, hidden('shared'))).toBe(true);
    expect(isCalendarEventVisible(merged, hidden('primary'))).toBe(true);
  });

  it('hides only when every calendar is hidden', () => {
    expect(isCalendarEventVisible(merged, hidden('primary', 'shared'))).toBe(
      false
    );
  });

  it('falls back to the displayed calendar without copy data', () => {
    const legacy = { calendar: SHARED, sourceCalendarIds: [] };
    expect(isCalendarEventVisible(legacy, hidden('shared'))).toBe(false);
    expect(isCalendarEventVisible(legacy, hidden('other'))).toBe(true);
  });
});

describe('mapCalendarEventToFullCalendar', () => {
  it('keeps each copy identity and title on the rendered event', () => {
    const [primary, shared] = mapCalendarOccurrenceChips(
      item([copy('primary'), sharedCopy]),
      { sourceById }
    ).map(mapCalendarEventToFullCalendar);

    expect(primary.id).toBe('["event","2026-09-10T13:00:00+00:00","primary"]');
    expect(shared.id).toBe('["event","2026-09-10T13:00:00+00:00","shared"]');
    expect(shared.title).toBe('[teo] OOO');
    expect(primary.extendedProps?.calendarEventId).toBe(primary.id);
    expect(shared.extendedProps?.calendarEventId).toBe(shared.id);
  });
});
