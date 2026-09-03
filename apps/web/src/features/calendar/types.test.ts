import { describe, expect, it } from 'vitest';
import { type CalendarEvent, isCalendarEventVisible } from './types';

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: '["event","occurrence"]',
    eventId: 'event',
    occurrenceKey: 'occurrence',
    isCancelled: false,
    isReadOnly: false,
    attendees: [],
    recurrenceLines: [],
    sourceCalendarIds: [],
    title: 'Out of office',
    start: '2026-09-10T00:00:00.000Z',
    end: '2026-09-19T00:00:00.000Z',
    allDay: true,
    calendar: { id: 'shared', name: 'Macro Vacation', color: 'orange' },
    ...overrides,
  };
}

const hidden = (...ids: string[]) => {
  const set = new Set(ids);
  return (id: string) => !set.has(id);
};

describe('isCalendarEventVisible', () => {
  it('stays visible while any of its source calendars is shown', () => {
    const merged = event({ sourceCalendarIds: ['primary', 'shared'] });
    expect(isCalendarEventVisible(merged, hidden('shared'))).toBe(true);
    expect(isCalendarEventVisible(merged, hidden('primary'))).toBe(true);
  });

  it('hides only when every source calendar is hidden', () => {
    const merged = event({ sourceCalendarIds: ['primary', 'shared'] });
    expect(isCalendarEventVisible(merged, hidden('primary', 'shared'))).toBe(
      false
    );
  });

  it('falls back to the canonical calendar when no source ids are present', () => {
    const legacy = event({ sourceCalendarIds: [] });
    expect(isCalendarEventVisible(legacy, hidden('shared'))).toBe(false);
    expect(isCalendarEventVisible(legacy, hidden('other'))).toBe(true);
  });
});
