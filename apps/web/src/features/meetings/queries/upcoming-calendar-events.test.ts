import { invalidateCalendarOccurrences } from '@queries/calendar/occurrences';
import { storageServiceClient } from '@service-storage/client';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createComponent, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarSource } from '../../calendar/types';
import { useUpcomingCalendarEventsSource } from './upcoming-calendar-events';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { listCalendarOccurrences: vi.fn() },
}));

let client: QueryClient;
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));

const today = new Date(2026, 8, 23, 12);
const source: CalendarSource = { id: 'primary', name: 'Work', color: 'blue' };
const sources = new Map([[source.id, source]]);
const list = vi.mocked(storageServiceClient.listCalendarOccurrences);
const disposers: (() => void)[] = [];

function occurrence(
  day: number,
  overrides: Partial<CalendarOccurrenceItem['event']> = {},
  cancelled = false
): CalendarOccurrenceItem {
  const startsAt = new Date(2026, 8, 23 + day, 13).toISOString();
  const endsAt = new Date(2026, 8, 23 + day, 14).toISOString();
  const time = { kind: 'timed' as const, startsAt, endsAt };
  const id = `event-${day}`;
  return {
    event: {
      id,
      ownerId: 'macro|self@example.com',
      icalUid: id,
      calendarId: source.id,
      title: id,
      status: 'confirmed',
      visibility: 'default',
      transparency: 'opaque',
      eventType: 'default',
      conferenceUrl: 'https://meet.google.com/room',
      time,
      recurrenceLines: [],
      sequence: 0,
      isReadOnly: false,
      attendees: [],
      createdAt: today.toISOString(),
      updatedAt: today.toISOString(),
      ...overrides,
    },
    occurrence: {
      eventId: id,
      occurrenceKey: startsAt,
      time,
      isCancelled: cancelled,
    },
  };
}

function respond(items: CalendarOccurrenceItem[]) {
  list.mockResolvedValue(ok({ items, hasMore: false, syncStatus: 'ready' }));
}

function setup() {
  const [now, setNow] = createSignal(today);
  const [userId, setUserId] = createSignal<string | undefined>(
    'macro|self@example.com'
  );
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  let result!: ReturnType<typeof useUpcomingCalendarEventsSource>;
  const Harness = () => {
    result = useUpcomingCalendarEventsSource({
      userId,
      now,
      sourceById: () => sources,
      isSourceVisible: (id) => !hidden().has(id),
    });
    return null;
  };
  const dispose = createRoot((dispose) => {
    createComponent(QueryClientProvider, {
      client,
      get children() {
        return createComponent(Harness, {});
      },
    });
    return dispose;
  });
  disposers.push(dispose);
  return { result, setNow, setUserId, setHidden };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  list.mockReset();
  respond([]);
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  client.clear();
});

describe('upcoming calendar events source', () => {
  it('stops after the first window when five events are available', async () => {
    respond([5, 3, 2, 4, 1].map((day) => occurrence(day)));
    const { result } = setup();
    await vi.waitFor(() => expect(result.events()).toHaveLength(5));
    expect(result.events().map((call) => call.title)).toEqual(
      [1, 2, 3, 4, 5].map((day) => `event-${day}`)
    );
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.loading()).toBe(false);
    expect(result.findEvent(result.events()[0].id)).toEqual(
      expect.objectContaining({
        title: 'event-1',
        attendees: [],
        isReadOnly: false,
      })
    );
  });

  it('widens to later windows after filtering cancelled, declined and hidden events', async () => {
    const hidden = occurrence(1, {
      sources: [
        {
          calendarId: 'hidden',
          title: 'Hidden',
          isReadOnly: false,
          eventType: 'default',
          reminders: { useDefault: true, overrides: [] },
          transparency: 'opaque',
          visibility: 'default',
        },
      ],
    });
    list
      .mockResolvedValueOnce(
        ok({
          items: [
            hidden,
            occurrence(2, {}, true),
            occurrence(3, {
              attendees: [
                {
                  email: 'self@example.com',
                  isSelf: true,
                  isOrganizer: false,
                  isOptional: false,
                  responseStatus: 'declined',
                },
              ],
            }),
            occurrence(4, { eventType: 'out_of_office' }),
            occurrence(5, { conferenceUrl: 'javascript:alert(1)' }),
            occurrence(6, { conferenceUrl: null }),
          ],
          hasMore: false,
          syncStatus: 'ready',
        })
      )
      .mockResolvedValueOnce(
        ok({
          items: [16, 17, 18, 19, 20].map((day) => occurrence(day)),
          hasMore: false,
          syncStatus: 'ready',
        })
      );
    const { result, setHidden } = setup();
    setHidden(new Set(['hidden']));
    await vi.waitFor(() => expect(result.events()).toHaveLength(8));
    expect(
      result
        .events()
        .map((event) => event.title)
        .slice(0, 3)
    ).toEqual(['event-4', 'event-5', 'event-6']);
    expect(result.events()[1].url).toBeUndefined();
    expect(result.events()[2].url).toBeUndefined();
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1][0].start).toBe(list.mock.calls[0][0].end);
  });

  it('stops sparse-calendar lookups at the supported 729-day horizon', async () => {
    const { result } = setup();
    await vi.waitFor(() => expect(result.loading()).toBe(false));
    expect(list).toHaveBeenCalledTimes(6);
    const end = new Date(today);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 729);
    expect(list.mock.calls[5][0].end).toBe(end.toISOString());
    expect(result.events()).toEqual([]);
  });

  it('keeps recurring occurrences and recognizes embedded Macro links', async () => {
    const macroUrl = 'https://macro.com/app/meet/valid-token-1234567890';
    respond(
      [1, 2, 3, 4, 5].map((day) =>
        occurrence(day, {
          id: 'series',
          conferenceUrl: null,
          description: `<p>Join <a href="${macroUrl}?join=true">the call</a></p>`,
        })
      )
    );
    const { result } = setup();
    await vi.waitFor(() => expect(result.events()).toHaveLength(5));
    expect(new Set(result.events().map((call) => call.id)).size).toBe(5);
    expect(result.events().every((call) => call.url === macroUrl)).toBe(true);
  });

  it('widens when a displayed call ends and refreshes through shared calendar invalidation', async () => {
    list
      .mockResolvedValueOnce(
        ok({
          items: [0, 1, 2, 3, 4].map((day) => occurrence(day)),
          hasMore: false,
          syncStatus: 'ready',
        })
      )
      .mockResolvedValueOnce(
        ok({ items: [occurrence(16)], hasMore: false, syncStatus: 'ready' })
      );
    const { result, setNow } = setup();
    await vi.waitFor(() => expect(result.events()).toHaveLength(5));
    setNow(new Date(2026, 8, 23, 14));
    await vi.waitFor(() =>
      expect(result.events().at(-1)?.title).toBe('event-16')
    );
    expect(result.events().some((call) => call.title === 'event-0')).toBe(
      false
    );
    respond([1, 2, 3, 4, 5].map((day) => occurrence(day)));
    await invalidateCalendarOccurrences();
    await vi.waitFor(() =>
      expect(result.events().at(-1)?.title).toBe('event-5')
    );
  });

  it("does not show another account's placeholder data after switching users", async () => {
    respond([1, 2, 3, 4, 5].map((day) => occurrence(day)));
    const { result, setUserId } = setup();
    await vi.waitFor(() => expect(result.events()).toHaveLength(5));
    list.mockImplementation(() => new Promise(() => {}));
    setUserId('macro|other@example.com');
    expect(result.events()).toEqual([]);
    expect(result.loading()).toBe(true);
  });
});
