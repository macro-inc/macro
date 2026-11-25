import type { CalendarEvent } from '@app/features/calendar/types';
import { describe, expect, it } from 'vitest';
import {
  buildCalendarToolPreviewEvent,
  calendarToolPreviewEvents,
} from './event-preview-model';

function event(eventId: string, start: string, title = eventId): CalendarEvent {
  const built = buildCalendarToolPreviewEvent({
    id: eventId,
    values: {
      title,
      allDay: false,
      start,
      end: start,
      recurrenceLines: [],
      guests: '',
      location: '',
      description: '',
      conference: 'none',
      calendarId: 'calendar-1',
    },
    time: {
      kind: 'timed',
      startsAt: start,
      endsAt: new Date(Date.parse(start) + 60 * 60 * 1000).toISOString(),
      timeZone: 'UTC',
    },
    recurrenceLines: [],
    calendar: { id: 'calendar-1', label: 'Calendar', color: '#609fe2' },
  });
  if (!built) throw new Error('unbuildable event');
  return { ...built, id: JSON.stringify([eventId, start]), isReadOnly: false };
}

const draft = event('calendar-tool-preview:call', '2030-01-02T19:00:00Z');
const created = event('event-created', '2030-01-02T19:00:00Z');
const planning = event('event-planning', '2030-01-02T15:00:00Z');

describe('calendarToolPreviewEvents', () => {
  it('draws the draft over the person’s events and highlights it', () => {
    const shown = calendarToolPreviewEvents({
      existing: [planning],
      draft: [draft],
      createdEventId: undefined,
      limit: 50,
    });
    expect(shown.events).toEqual([planning, draft]);
    expect([...shown.emphasizedIds]).toEqual([draft.id]);
    expect(shown.showsCreated).toBe(false);
  });

  it('replaces the draft with the created event and highlights it instead', () => {
    const shown = calendarToolPreviewEvents({
      existing: [planning, created],
      draft: [draft],
      createdEventId: 'event-created',
      limit: 50,
    });
    expect(shown.events).toEqual([planning, created]);
    expect([...shown.emphasizedIds]).toEqual([created.id]);
    expect(shown.showsCreated).toBe(true);
  });

  it('keeps the draft until the created event has loaded', () => {
    const shown = calendarToolPreviewEvents({
      existing: [planning],
      draft: [draft],
      createdEventId: 'event-created',
      limit: 50,
    });
    expect(shown.events).toEqual([planning, draft]);
    expect([...shown.emphasizedIds]).toEqual([draft.id]);
    expect(shown.showsCreated).toBe(false);
  });

  it('highlights every occurrence of a created series', () => {
    const next = event('event-created', '2030-01-09T19:00:00Z');
    const shown = calendarToolPreviewEvents({
      existing: [created, planning, next],
      draft: [draft],
      createdEventId: 'event-created',
      limit: 50,
    });
    expect(shown.events).toEqual([planning, created, next]);
    expect([...shown.emphasizedIds]).toEqual([created.id, next.id]);
  });

  it('draws the created event even past the cap on the person’s events', () => {
    const shown = calendarToolPreviewEvents({
      existing: [planning, created],
      draft: [draft],
      createdEventId: 'event-created',
      limit: 1,
    });
    expect(shown.events).toEqual([planning, created]);
  });
});
