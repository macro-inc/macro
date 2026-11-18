import { expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { Calendar } from './calendar';
import { CalendarNamespace } from './namespace';

test('calendar.createConfirmed creates through the confirmed tool with the quoted approval', async () => {
  const requests: unknown[] = [];
  const client = {
    cognition: {
      createConfirmedCalendarEvent: async ({ body }: { body: unknown }) => {
        requests.push(body);
        return { data: { eventId: 'created-event' } };
      },
    },
  } as unknown as MacroClient;

  const event = await new CalendarNamespace(client).createConfirmed({
    title: 'Q3 review',
    time: {
      kind: 'timed',
      startsAt: '2026-11-10T15:00:00Z',
      endsAt: '2026-11-10T15:30:00Z',
      timeZone: 'America/New_York',
    },
    attendees: [{ email: 'grace@example.com' }],
    addMacroCall: true,
    calendar: Calendar.byId(client, 'work-calendar'),
    userConfirmation: 'yes, book it',
  });

  expect(requests).toEqual([
    {
      title: 'Q3 review',
      time: {
        kind: 'timed',
        startsAt: '2026-11-10T15:00:00Z',
        endsAt: '2026-11-10T15:30:00Z',
        timeZone: 'America/New_York',
      },
      attendees: [{ email: 'grace@example.com' }],
      addMacroCall: true,
      calendarId: 'work-calendar',
      userConfirmation: 'yes, book it',
    },
  ]);
  expect(event.id).toBe('created-event');
});
