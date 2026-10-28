import type { CalendarEventEntity } from '@entity';
import { useSearchSoupQuery } from '@queries/soup/search';
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';

vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarSearchUiFlag: () => () => true,
}));
vi.mock('@queries/soup/search', () => ({ useSearchSoupQuery: vi.fn() }));

import {
  calendarEventMentionItems,
  useCalendarEventMention,
} from './useCalendarEventMention';

function event(
  id: string,
  overrides: Partial<CalendarEventEntity> = {}
): CalendarEventEntity {
  return {
    type: 'calendar_event',
    id,
    name: 'Standup',
    ownerId: 'macro|gab@macro.com',
    status: 'confirmed',
    isReadOnly: false,
    time: {
      kind: 'timed',
      startsAt: '2026-10-26T13:00:00Z',
      endsAt: '2026-10-26T13:30:00Z',
    },
    ...overrides,
  } as CalendarEventEntity;
}

it('offers each event once, pinned to its occurrence only when it repeats', () => {
  const items = calendarEventMentionItems([
    event('series', {
      isRecurring: true,
      occurrenceKey: '2026-10-27T13:00:00Z',
    }),
    event('series', {
      isRecurring: true,
      occurrenceKey: '2026-10-28T13:00:00Z',
    }),
    event('single', { occurrenceKey: '2026-10-26T13:00:00Z' }),
    event('untitled', { name: '' }),
  ]);

  expect(items.map((item) => item.id)).toEqual([
    'series',
    'single',
    'untitled',
  ]);
  expect(items[0].data.occurrenceKey).toBe('2026-10-27T13:00:00Z');
  expect(items[1].data.occurrenceKey).toBeUndefined();
  expect(items[2].data.title).toBe('Untitled event');
  expect(items[0].data.when).toBeTruthy();
});

type SearchState = {
  isPending: boolean;
  status: string;
  data: CalendarEventEntity[] | undefined;
};

const NO_SHARES: SearchState = {
  isPending: false,
  status: 'success',
  data: [],
};

function mentionTitles(own: SearchState, shared: SearchState = NO_SHARES) {
  vi.mocked(useSearchSoupQuery).mockImplementation(
    (args) =>
      (args().body.calendar_event_scope === 'shared_with_you'
        ? shared
        : own) as unknown as ReturnType<typeof useSearchSoupQuery>
  );
  return createRoot((dispose) => {
    const { events } = useCalendarEventMention({
      enabled: () => true,
      searchTerm: () => 'Standup',
    });
    const titles = events().map((item) => item.data.title);
    dispose();
    return titles;
  });
}

it('keeps the found events when a later search fails, and waits for the first one', () => {
  expect(
    mentionTitles({ isPending: false, status: 'error', data: [event('a')] })
  ).toEqual(['Standup']);
  expect(
    mentionTitles({ isPending: true, status: 'pending', data: undefined })
  ).toEqual([]);
});

it('lists events shared with your channels after your own, in their order', () => {
  const own: SearchState = {
    isPending: false,
    status: 'success',
    data: [
      event('b', { name: 'Standup B' }),
      event('a', { name: 'Standup A' }),
    ],
  };
  const shared: SearchState = {
    isPending: false,
    status: 'success',
    data: [event('shared', { name: 'Standup shared' })],
  };

  expect(mentionTitles(own, shared)).toEqual([
    'Standup B',
    'Standup A',
    'Standup shared',
  ]);
  // A shared answer that lands first waits for your own events.
  expect(
    mentionTitles(
      { isPending: true, status: 'pending', data: undefined },
      shared
    )
  ).toEqual([]);
  expect(
    mentionTitles(own, { isPending: true, status: 'pending', data: undefined })
  ).toEqual(['Standup B', 'Standup A']);
});
