import type { CalendarEventSourceContent } from '@service-storage/generated/schemas/calendarEventSourceContent';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { describe, expect, it } from 'vitest';
import {
  type CalendarEvent,
  type CalendarSource,
  isCalendarEventVisible,
  mapCalendarEventToFullCalendar,
  mapCalendarOccurrence,
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
    expect(event.reminderEventType).toBe('out_of_office');
    expect(event.eventType).toBe('default');
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
    expect(event.reminderEventType).toBe('out_of_office');
    expect(event.sourceCalendarIds).toEqual([]);
  });
});

describe('mapCalendarOccurrenceChips', () => {
  const split = (...ids: string[]) => {
    const set = new Set(ids);
    return (id: string) => !set.has(id);
  };
  const twoCopies = () => item([copy('primary'), sharedCopy]);

  it('folds every copy into one chip while its calendars are merged', () => {
    const chips = mapCalendarOccurrenceChips(twoCopies(), {
      sourceById,
      isSourceMerged: split(),
    });

    expect(chips).toHaveLength(1);
    expect(chips[0]).toEqual(
      mapCalendarOccurrence(twoCopies(), { sourceById })
    );
  });

  it('shows a split calendar copy beside the merged chip', () => {
    const chips = mapCalendarOccurrenceChips(twoCopies(), {
      sourceById,
      isSourceMerged: split('shared'),
    });

    expect(chips).toHaveLength(2);
    const [merged, own] = chips;
    expect(merged.title).toBe('OOO');
    expect(merged.calendarId).toBe('primary');
    expect(merged.sourceCalendarIds).toEqual(['primary']);
    expect(JSON.parse(merged.id)).toHaveLength(2);
    expect(own.title).toBe('[teo] OOO');
    expect(own.calendar).toBe(SHARED);
    expect(own.calendarId).toBe('shared');
    expect(own.isReadOnly).toBe(true);
    expect(own.sourceCalendarIds).toEqual(['shared']);
    expect(JSON.parse(own.id)).toEqual(['event', expect.any(String), 'shared']);
    expect(own.reminderCalendarId).toBe('primary');
    expect(own.reminders?.overrides).toEqual([
      { method: 'popup', minutes: 30 },
    ]);
  });

  it('renders only the split copies when every calendar is split', () => {
    const chips = mapCalendarOccurrenceChips(twoCopies(), {
      sourceById,
      isSourceMerged: split('primary', 'shared'),
    });

    expect(chips.map((chip) => chip.calendarId)).toEqual(['primary', 'shared']);
    expect(chips.every((chip) => JSON.parse(chip.id).length === 3)).toBe(true);
  });

  it('hides a split copy with its calendar and keeps the merged chip', () => {
    const chips = mapCalendarOccurrenceChips(twoCopies(), {
      sourceById,
      isSourceVisible: hidden('shared'),
      isSourceMerged: split('shared'),
    });

    expect(
      chips.filter((chip) => isCalendarEventVisible(chip, hidden('shared')))
    ).toHaveLength(1);
  });

  it('keeps a single-copy event as one chip whichever mode its calendar is in', () => {
    const chips = mapCalendarOccurrenceChips(item([copy('primary')]), {
      sourceById,
      isSourceMerged: split('primary'),
    });

    expect(chips).toHaveLength(1);
    expect(JSON.parse(chips[0].id)).toHaveLength(2);
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
  it('keeps the occurrence identity whichever copy is displayed', () => {
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

    expect(onPrimary.id).toBe('["event","2026-09-10T13:00:00+00:00"]');
    expect(onShared.id).toBe(onPrimary.id);
    expect(onShared.title).toBe('[teo] OOO');
    expect(onShared.extendedProps?.calendarEventId).toBe(onPrimary.id);
  });
});
