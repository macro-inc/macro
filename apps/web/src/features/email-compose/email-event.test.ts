import { afterEach, expect, it, vi } from 'vitest';
import { suggestEmailEvent } from './email-event';

const extract = vi.hoisted(() => vi.fn());
vi.mock('@service-agent-harness/universal-input', () => ({
  universalInputClient: { extract },
}));

afterEach(() => extract.mockReset());

it('sends the subject and text and maps the extracted event', async () => {
  extract.mockResolvedValue({
    revision: 0,
    intent: 'calendar',
    suggestions: {
      title: 'Q1 planning',
      body: 'ignored',
      start: '2026-11-10T14:00',
      start_assumption: null,
      end: '2026-11-10T15:00',
      location: 'Room 4',
      guests: ['someone@example.com'],
      recurrence: {
        frequency: 'WEEKLY',
        interval: 1,
        by_day: ['TU'],
        monthly_by_day: null,
        ends: { kind: 'never' },
      },
    },
  });

  const suggested = await suggestEmailEvent(
    'Planning',
    'Tuesday at 2pm in Room 4, every week until March.'
  );

  expect(extract).toHaveBeenCalledWith(
    'Planning\n\nTuesday at 2pm in Room 4, every week until March.',
    'calendar',
    0
  );
  expect(suggested).toEqual({
    title: 'Q1 planning',
    start: '2026-11-10T14:00',
    end: '2026-11-10T15:00',
    location: 'Room 4',
    recurrenceLines: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
  });
});

it('suggests nothing for fields the email does not state', async () => {
  extract.mockResolvedValue({
    revision: 0,
    intent: 'calendar',
    suggestions: {
      title: null,
      body: null,
      start: null,
      start_assumption: null,
      end: null,
      location: null,
      guests: [],
      recurrence: null,
    },
  });

  expect(await suggestEmailEvent('Planning', 'Thanks!')).toEqual({});
});
