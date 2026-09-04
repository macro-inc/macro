import type { CalendarEventSourceContent } from '@service-storage/generated/schemas/calendarEventSourceContent';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { describe, expect, it } from 'vitest';
import {
  type CalendarEvent,
  type CalendarSource,
  isCalendarEventVisible,
  mapCalendarEventToFullCalendar,
  mapCalendarOccurrence,
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

describe('mapCalendarOccurrence', () => {
  it('shows the primary copy while its calendar is on', () => {
    const event = mapCalendarOccurrence(item([copy('primary'), sharedCopy]), {
      sourceById,
      isSourceVisible: hidden(),
    });

    expect(event.calendar).toBe(PRIMARY);
    expect(event.calendarId).toBe('primary');
    expect(event.title).toBe('OOO');
    expect(event.eventType).toBe('out_of_office');
    expect(event.isReadOnly).toBe(false);
    expect(event.reminders?.overrides).toEqual([
      { method: 'popup', minutes: 30 },
    ]);
    expect(event.reminderCalendarId).toBe('primary');
    expect(event.creatorEmail).toBe('teo@example.com');
    expect(event.sourceCalendarIds).toEqual(['primary', 'shared']);
  });

  it('falls through to the shared copy once the primary calendar is hidden', () => {
    const event = mapCalendarOccurrence(item([copy('primary'), sharedCopy]), {
      sourceById,
      isSourceVisible: hidden('primary'),
    });

    expect(event.calendar).toBe(SHARED);
    expect(event.calendarId).toBe('shared');
    expect(event.title).toBe('[teo] OOO');
    expect(event.eventType).toBe('default');
    expect(event.isReadOnly).toBe(true);
    expect(event.creatorEmail).toBe('script@example.com');
  });

  it('keeps the reminders that fire on the primary copy whichever copy shows', () => {
    const event = mapCalendarOccurrence(item([copy('primary'), sharedCopy]), {
      sourceById,
      isSourceVisible: hidden('primary'),
    });

    expect(event.reminders?.overrides).toEqual([
      { method: 'popup', minutes: 30 },
    ]);
    expect(event.reminderCalendarId).toBe('primary');
    expect(event.calendarId).toBe('shared');
  });

  it('keeps the canonical copy when every calendar is hidden', () => {
    const event = mapCalendarOccurrence(item([copy('primary'), sharedCopy]), {
      sourceById,
      isSourceVisible: hidden('primary', 'shared'),
    });

    expect(event.calendarId).toBe('primary');
    expect(event.title).toBe('OOO');
  });

  it('reads the entity when no copy data is present', () => {
    const event = mapCalendarOccurrence(item([]), { sourceById });

    expect(event.title).toBe('OOO');
    expect(event.calendarId).toBeUndefined();
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
  it('keys the rendered event by the displayed calendar and keeps the occurrence id', () => {
    const merged = item([copy('primary'), sharedCopy]);
    const onPrimary = mapCalendarEventToFullCalendar(
      mapCalendarOccurrence(merged, { sourceById, isSourceVisible: hidden() })
    );
    const onShared = mapCalendarEventToFullCalendar(
      mapCalendarOccurrence(merged, {
        sourceById,
        isSourceVisible: hidden('primary'),
      })
    );

    expect(onPrimary.id).not.toBe(onShared.id);
    expect(onPrimary.extendedProps?.calendarEventId).toBe(
      '["event","2026-09-10T13:00:00+00:00"]'
    );
    expect(onShared.extendedProps?.calendarEventId).toBe(
      onPrimary.extendedProps?.calendarEventId
    );
  });
});
