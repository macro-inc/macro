import { storageServiceClient } from '@service-storage/client';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCalendarOccurrenceQueryRange,
  fetchCalendarOccurrences,
} from '../occurrences';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    listCalendarOccurrences: vi.fn(),
  },
}));

const range = {
  start: '2026-08-01T04:00:00.000Z',
  end: '2026-09-01T04:00:00.000Z',
  startDate: '2026-08-01',
  endDate: '2026-09-01',
};

const occurrence = (
  eventId: string,
  occurrenceKey: string
): CalendarOccurrenceItem =>
  ({
    event: { id: eventId },
    occurrence: { occurrenceKey },
  }) as CalendarOccurrenceItem;

describe('fetchCalendarOccurrences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches every page, forwards cancellation, and deduplicates occurrences', async () => {
    const first = occurrence('event-1', '2026-08-01T14:00:00Z');
    const second = occurrence('event-1', '2026-08-08T14:00:00Z');
    vi.mocked(storageServiceClient.listCalendarOccurrences)
      .mockResolvedValueOnce(
        ok({
          items: [first],
          hasMore: true,
          nextCursor: 'next-page',
          syncStatus: CalendarSyncStatus.ready,
        })
      )
      .mockResolvedValueOnce(
        ok({
          items: [first, second],
          hasMore: false,
          nextCursor: null,
          syncStatus: CalendarSyncStatus.syncing,
        })
      );
    const controller = new AbortController();

    await expect(
      fetchCalendarOccurrences(range, controller.signal)
    ).resolves.toEqual({
      items: [first, second],
      syncStatus: CalendarSyncStatus.syncing,
    });
    expect(
      storageServiceClient.listCalendarOccurrences
    ).toHaveBeenNthCalledWith(1, {
      ...range,
      cursor: undefined,
      limit: 2000,
      signal: controller.signal,
    });
    expect(
      storageServiceClient.listCalendarOccurrences
    ).toHaveBeenNthCalledWith(2, {
      ...range,
      cursor: 'next-page',
      limit: 2000,
      signal: controller.signal,
    });
  });

  it('rejects a missing cursor when another page is expected', async () => {
    vi.mocked(storageServiceClient.listCalendarOccurrences).mockResolvedValue(
      ok({
        items: [],
        hasMore: true,
        nextCursor: null,
        syncStatus: CalendarSyncStatus.ready,
      })
    );

    await expect(fetchCalendarOccurrences(range)).rejects.toThrow(
      'Calendar occurrence pagination returned an invalid cursor'
    );
  });

  it('rejects a repeated cursor', async () => {
    vi.mocked(storageServiceClient.listCalendarOccurrences)
      .mockResolvedValueOnce(
        ok({
          items: [],
          hasMore: true,
          nextCursor: 'repeated',
          syncStatus: CalendarSyncStatus.ready,
        })
      )
      .mockResolvedValueOnce(
        ok({
          items: [],
          hasMore: true,
          nextCursor: 'repeated',
          syncStatus: CalendarSyncStatus.ready,
        })
      );

    await expect(fetchCalendarOccurrences(range)).rejects.toThrow(
      'Calendar occurrence pagination returned an invalid cursor'
    );
  });
});

describe('calendar range helpers', () => {
  it('uses UTC instants with local all-day boundaries', () => {
    const start = new Date(2026, 7, 3, 0, 0, 0);
    const end = new Date(2026, 7, 10, 0, 0, 0);

    expect(createCalendarOccurrenceQueryRange(start, end)).toEqual({
      start: start.toISOString(),
      end: end.toISOString(),
      startDate: '2026-08-03',
      endDate: '2026-08-10',
    });
  });
});
