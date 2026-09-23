import { describe, expect, test } from 'bun:test';
import type { CalendarEvent as CalendarEventRecord } from '../../../generated/calendar/types.gen';
import { MacroError } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { CalendarEvent } from './event';

const client = new Proxy({} as MacroClient, {
  get() {
    throw new Error('Seeded state access must not fetch');
  },
});

const record: CalendarEventRecord = {
  id: 'event-1',
  ownerId: 'macro|user@example.com',
  calendarId: 'calendar-1',
  icalUid: 'ical-1',
  title: 'Standup',
  description: 'Daily sync',
  location: 'Room 1',
  attendees: [],
  recurrenceLines: [],
  sequence: 0,
  status: 'confirmed',
  isReadOnly: false,
  time: {
    kind: 'timed',
    startsAt: '2026-01-01T09:00:00Z',
    endsAt: '2026-01-01T09:15:00Z',
  },
  transparency: 'opaque',
  visibility: 'default',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('CalendarEvent', () => {
  test('a seeded handle reads fields without fetching', async () => {
    const event = CalendarEvent.fromRecord(client, record);
    expect(event.id).toBe('event-1');
    expect(await event.title()).toBe('Standup');
    expect(await event.description()).toBe('Daily sync');
    expect(await event.isReadOnly()).toBe(false);
    expect(await event.status()).toBe('confirmed');
    expect(await event.record()).toEqual(record);
  });

  test('calendarId is exposed as a Calendar handle', async () => {
    const event = CalendarEvent.fromRecord(client, record);
    const calendar = await event.calendar();
    expect(calendar?.id).toBe('calendar-1');
  });

  test('a bare byId handle has no fetch endpoint', async () => {
    const event = CalendarEvent.byId(client, 'event-2');
    expect(event.id).toBe('event-2');
    await expect(event.title()).rejects.toBeInstanceOf(MacroError);
  });
});
