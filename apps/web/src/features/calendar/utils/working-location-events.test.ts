import { EventType } from '@service-storage/generated/schemas/eventType';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarSource } from '../types';
import { mergeWorkingLocationEvents } from './working-location-events';

const OFFICE: CalendarSource = { id: 'cal-1', name: 'Work', color: 'blue' };
const OTHER_CAL: CalendarSource = { id: 'cal-2', name: 'Home', color: 'green' };

interface EventOverrides {
  title?: string;
  location?: string;
  eventType?: EventType;
  allDay?: boolean;
  calendar?: CalendarSource;
  isCancelled?: boolean;
}

/** An all-day event spanning `[start, end)` as RFC 5545 date strings. */
function event(
  id: string,
  start: string,
  end: string,
  overrides: EventOverrides = {}
): CalendarEvent {
  return {
    id,
    eventId: id,
    occurrenceKey: id,
    isCancelled: overrides.isCancelled ?? false,
    isReadOnly: true,
    attendees: [],
    recurrenceLines: ['RRULE:FREQ=WEEKLY'],
    title: overrides.title ?? 'Office',
    start,
    end,
    allDay: overrides.allDay ?? true,
    calendar: overrides.calendar ?? OFFICE,
    eventType: overrides.eventType ?? EventType.working_location,
    location: overrides.location,
  };
}

/** Compact `[id, start, end]` view of the merge output for assertions. */
function spans(events: CalendarEvent[]) {
  return events.map((e) => [e.id, e.start, e.end]);
}

describe('mergeWorkingLocationEvents', () => {
  it('merges a run of consecutive working-location days into one bar', () => {
    const result = mergeWorkingLocationEvents([
      event('mon', '2026-08-31', '2026-09-01'),
      event('tue', '2026-09-01', '2026-09-02'),
      event('wed', '2026-09-02', '2026-09-03'),
      event('thu', '2026-09-03', '2026-09-04'),
      event('fri', '2026-09-04', '2026-09-05'),
    ]);

    expect(spans(result)).toEqual([['mon', '2026-08-31', '2026-09-05']]);
  });

  it('keeps runs separated by a gap as distinct bars', () => {
    const result = mergeWorkingLocationEvents([
      event('mon', '2026-08-31', '2026-09-01'),
      event('tue', '2026-09-01', '2026-09-02'),
      // Wednesday off.
      event('thu', '2026-09-03', '2026-09-04'),
      event('fri', '2026-09-04', '2026-09-05'),
    ]);

    expect(spans(result)).toEqual([
      ['mon', '2026-08-31', '2026-09-02'],
      ['thu', '2026-09-03', '2026-09-05'],
    ]);
  });

  it('collapses a duplicate occurrence on the same day', () => {
    const result = mergeWorkingLocationEvents([
      event('thu-a', '2026-09-03', '2026-09-04'),
      event('thu-b', '2026-09-03', '2026-09-04'),
    ]);

    expect(spans(result)).toEqual([['thu-a', '2026-09-03', '2026-09-04']]);
  });

  it('does not merge different working locations', () => {
    const result = mergeWorkingLocationEvents([
      event('mon', '2026-08-31', '2026-09-01', { title: 'Office' }),
      event('tue', '2026-09-01', '2026-09-02', { title: 'Home' }),
    ]);

    expect(spans(result)).toEqual([
      ['mon', '2026-08-31', '2026-09-01'],
      ['tue', '2026-09-01', '2026-09-02'],
    ]);
  });

  it('does not merge working locations from different calendars', () => {
    const result = mergeWorkingLocationEvents([
      event('mon', '2026-08-31', '2026-09-01', { calendar: OFFICE }),
      event('tue', '2026-09-01', '2026-09-02', { calendar: OTHER_CAL }),
    ]);

    expect(result).toHaveLength(2);
  });

  it('leaves non-working-location events untouched and by reference', () => {
    const meeting = event('meet', '2026-09-01', '2026-09-01', {
      eventType: EventType.default,
      allDay: false,
    });
    const result = mergeWorkingLocationEvents([meeting]);

    expect(result).toEqual([meeting]);
    expect(result[0]).toBe(meeting);
  });

  it('does not merge cancelled occurrences into a run', () => {
    const result = mergeWorkingLocationEvents([
      event('mon', '2026-08-31', '2026-09-01'),
      event('tue', '2026-09-01', '2026-09-02', { isCancelled: true }),
      event('wed', '2026-09-02', '2026-09-03'),
    ]);

    const officeSpans = result
      .filter((e) => !e.isCancelled)
      .map((e) => [e.start, e.end]);
    // Tuesday cancelled leaves a gap, so Monday and Wednesday stay separate.
    expect(officeSpans).toEqual([
      ['2026-08-31', '2026-09-01'],
      ['2026-09-02', '2026-09-03'],
    ]);
  });

  it('sorts an out-of-order run before merging', () => {
    const result = mergeWorkingLocationEvents([
      event('wed', '2026-09-02', '2026-09-03'),
      event('mon', '2026-08-31', '2026-09-01'),
      event('tue', '2026-09-01', '2026-09-02'),
    ]);

    expect(spans(result)).toEqual([['mon', '2026-08-31', '2026-09-03']]);
  });
});
