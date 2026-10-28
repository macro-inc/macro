import type {
  EventType,
  SchedulingProfile,
} from '@app/features/scheduling/core/types';
import { useQuery } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@tanstack/solid-query', () => ({ useQuery: vi.fn() }));
vi.mock('@service-email/scheduling', () => ({ schedulingClient: {} }));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    data: { team: { id: 'team-1', name: 'Macro' } },
  }),
}));

import { useBookingLinkMention } from './useBookingLinkMention';

function eventType(id: string, title: string, enabled = true): EventType {
  return {
    id,
    title,
    slug: id,
    durationMinutes: 30,
    enabled,
  } as EventType;
}

function profile(id: string, eventTypes: EventType[]): SchedulingProfile {
  return { id, eventTypes } as SchedulingProfile;
}

const PERSONAL = profile('personal-profile', [
  eventType('candidates', 'Chat with Teo: Engineering Candidates'),
  eventType('coffee', 'Coffee chat'),
  eventType('retired', 'Retired intro', false),
]);
const TEAM = profile('team-profile', [eventType('demo', 'Product demo')]);

afterEach(() => {
  vi.mocked(useQuery).mockReset();
});

function bookingLinkTitles(searchTerm: string) {
  const queriesEnabled: boolean[] = [];
  vi.mocked(useQuery).mockImplementation((options) => {
    const resolved = options();
    queriesEnabled.push(resolved.enabled !== false);
    const scope = resolved.queryKey.at(-1);
    return {
      isSuccess: true,
      isPending: false,
      data: scope === 'me' ? PERSONAL : TEAM,
    } as unknown as ReturnType<typeof useQuery>;
  });
  return createRoot((dispose) => {
    const { bookingLinks } = useBookingLinkMention({
      enabled: () => true,
      searchTerm: () => searchTerm,
    });
    const titles = bookingLinks().map((item) => item.data.title);
    dispose();
    return { titles, queriesEnabled };
  });
}

it('lists every enabled personal and team link for a bare mention', () => {
  expect(bookingLinkTitles('').titles).toEqual([
    'Chat with Teo: Engineering Candidates',
    'Coffee chat',
    'Product demo',
  ]);
});

it('keeps loading booking links while a query is typed and finds them by title', () => {
  const exact = bookingLinkTitles('Chat with Teo: Engineering Candidates');
  expect(exact.queriesEnabled.every(Boolean)).toBe(true);
  expect(exact.titles).toEqual(['Chat with Teo: Engineering Candidates']);

  expect(bookingLinkTitles('Chat').titles).toEqual(
    expect.arrayContaining([
      'Chat with Teo: Engineering Candidates',
      'Coffee chat',
    ])
  );
  expect(bookingLinkTitles('Chat').titles).not.toContain('Product demo');
  expect(bookingLinkTitles('demo').titles).toEqual(['Product demo']);
});

it('offers no booking links when the query matches no title', () => {
  expect(bookingLinkTitles('quarterly').titles).toEqual([]);
});
