import type { CalendarRangeCacheResult } from '@graphql-cache/index';
import type { CalendarRangeInput } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, vi } from 'vitest';
import { calendarBackfillMonths, runCalendarBackfill } from '../backfill';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));

const covered: CalendarRangeCacheResult = {
  kind: 'range',
  revision: '1' as never,
  occurrenceKeys: [],
  gaps: [],
  freshness: 'fresh',
  uncertainEventKeys: [],
  optimistic: false,
  watermark: [{ linkId: 'link-1', seq: '1' }],
};

describe('calendarBackfillMonths', () => {
  it('starts at this month and alternates outward within the served range', () => {
    const now = new Date(2026, 9, 7, 15);
    const months = calendarBackfillMonths(now, 2);
    expect(months.map((range) => range.startDate)).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-09-01',
      '2026-12-01',
      '2026-08-01',
    ]);
    expect(months[0]?.endDate).toBe('2026-11-01');
  });

  it('clamps the oldest month to the served history', () => {
    const now = new Date(2026, 9, 7, 15);
    const oldest = calendarBackfillMonths(now).at(-1);
    expect(oldest?.startDate).toBe('2025-10-08');
    expect(oldest?.endDate).toBe('2025-11-01');
  });
});

describe('runCalendarBackfill', () => {
  it('skips covered months and fetches gaps through hydration', async () => {
    const now = new Date(2026, 9, 7, 15);
    const months = calendarBackfillMonths(now, 1);
    const gapStart = Date.parse(months[1]?.start ?? '');
    const gapEnd = Date.parse(months[1]?.end ?? '');
    const host = {
      calendarRange: vi
        .fn()
        .mockResolvedValue(covered)
        .mockResolvedValueOnce(covered)
        .mockResolvedValueOnce({
          ...covered,
          gaps: [{ kind: 'timed', start: gapStart, end: gapEnd }],
        }),
      calendarCommit: vi.fn(async () => ({
        kind: 'committed' as const,
        revision: '2' as never,
        changed: [],
      })),
    };
    const fetchPage = vi.fn(async (_input: CalendarRangeInput) => ({
      nodes: [],
      hasNextPage: false,
      endCursor: null,
      syncStatus: 'READY' as const,
      watermark: [{ linkId: 'link-1', seq: '3' }],
    }));

    await runCalendarBackfill(host, {
      signal: new AbortController().signal,
      now,
      fetchPage,
      delayMs: 0,
    });

    // Twenty-five months, each read once; only the gap month fetched.
    expect(host.calendarRange).toHaveBeenCalledTimes(25);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      start: new Date(gapStart).toISOString(),
      end: new Date(gapEnd).toISOString(),
    });
    expect(host.calendarCommit).toHaveBeenCalledTimes(1);
  });

  it('stops when aborted or when the host cannot serve ranges', async () => {
    const abort = new AbortController();
    abort.abort();
    const host = {
      calendarRange: vi.fn(),
      calendarCommit: vi.fn(),
    };
    await runCalendarBackfill(host, { signal: abort.signal, delayMs: 0 });
    expect(host.calendarRange).not.toHaveBeenCalled();

    host.calendarRange.mockResolvedValue({ kind: 'unsupported' });
    await runCalendarBackfill(host, {
      signal: new AbortController().signal,
      delayMs: 0,
    });
    expect(host.calendarRange).toHaveBeenCalledTimes(1);
  });
});
