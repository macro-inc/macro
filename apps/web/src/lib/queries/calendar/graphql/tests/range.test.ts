import type { CalendarRangeCacheResult } from '@graphql-cache/index';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarOccurrenceQueryRange } from '../../occurrences';
import {
  beginCalendarSyncStatusSample,
  type CalendarOccurrencePage,
  calendarGapWindows,
  epochDay,
  fetchCalendarWindow,
  latestCalendarSyncStatus,
  lowestWatermark,
  readCalendarRange,
  recordCalendarSyncStatus,
  toCalendarRangeArgs,
} from '../range';
import { calendarCacheAnswered } from '../readiness';
import { graphqlOccurrence } from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));

const DAY_MS = 86_400_000;
const weekStart = new Date(2026, 9, 5);
const weekEnd = new Date(2026, 9, 12);
const week = createCalendarOccurrenceQueryRange(weekStart, weekEnd);

const range = (
  overrides: Partial<Extract<CalendarRangeCacheResult, { kind: 'range' }>>
): CalendarRangeCacheResult => ({
  kind: 'range',
  revision: '1' as never,
  occurrenceKeys: [],
  gaps: [],
  freshness: 'fresh',
  uncertainEventKeys: [],
  optimistic: false,
  watermark: null,
  ...overrides,
});

const page = (
  overrides: Partial<CalendarOccurrencePage> = {}
): CalendarOccurrencePage => ({
  nodes: [],
  hasNextPage: false,
  endCursor: null,
  syncStatus: 'READY',
  watermark: [{ linkId: 'link-1', seq: '9' }],
  ...overrides,
});

function fakeHost(results: CalendarRangeCacheResult[]) {
  return {
    calendarRange: vi.fn(async () => {
      const next = results.shift();
      if (!next) throw new Error('unexpected calendarRange');
      return next;
    }),
    calendarCommit: vi.fn(async () => ({
      kind: 'committed' as const,
      revision: '2' as never,
      changed: [],
    })),
    readRecordsByKeys: vi.fn(async ({ keys }: { keys: string[] }) => ({
      revision: '2' as never,
      records: keys.map((recordKey) => ({
        recordKey,
        record: graphqlOccurrence({
          id: recordKey.slice('GraphqlCalendarOccurrence:'.length),
        }),
      })),
    })),
  };
}

async function readData(...args: Parameters<typeof readCalendarRange>) {
  const read = await readCalendarRange(...args);
  if (read.kind !== 'range') throw new Error(`expected a range: ${read.kind}`);
  return read.data;
}

describe('readCalendarRange', () => {
  beforeEach(() =>
    recordCalendarSyncStatus(
      CalendarSyncStatus.ready,
      beginCalendarSyncStatusSample()
    )
  );

  it('answers a covered viewport without the network', async () => {
    const host = fakeHost([
      range({
        occurrenceKeys: ['GraphqlCalendarOccurrence:event-1:a'],
      }),
    ]);
    const fetchPage = vi.fn();
    const data = await readData(host, week, { fetchPage });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(host.calendarCommit).not.toHaveBeenCalled();
    expect(host.calendarRange).toHaveBeenCalledWith(toCalendarRangeArgs(week));
    expect(data?.items).toHaveLength(1);
    expect(data?.items[0]?.event.title).toBe('Standup');
    expect(data?.syncStatus).toBe(CalendarSyncStatus.ready);
  });

  it('fetches only the gaps, commits their coverage, and rereads', async () => {
    const args = toCalendarRangeArgs(week);
    const gapStart = args.startMs + 3 * DAY_MS;
    const host = fakeHost([
      range({
        gaps: [
          { kind: 'timed', start: gapStart, end: args.endMs },
          { kind: 'allDay', start: args.startDay + 3, end: args.endDay },
        ],
      }),
      range({ occurrenceKeys: ['GraphqlCalendarOccurrence:event-1:b'] }),
    ]);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        page({
          hasNextPage: true,
          endCursor: 'next',
          watermark: [
            { linkId: 'link-1', seq: '9' },
            { linkId: 'link-2', seq: '4' },
          ],
        })
      )
      .mockResolvedValueOnce(
        page({
          syncStatus: 'SYNCING',
          watermark: [
            { linkId: 'link-1', seq: '7' },
            { linkId: 'link-2', seq: '5' },
          ],
        })
      );

    const data = await readData(host, week, { fetchPage });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[0]?.[0]).toEqual({
      start: new Date(gapStart).toISOString(),
      end: new Date(args.endMs).toISOString(),
      startDate: '2026-10-08',
      endDate: '2026-10-12',
      first: 2000,
    });
    expect(fetchPage.mock.calls[1]?.[0]).toMatchObject({ after: 'next' });
    expect(host.calendarCommit).toHaveBeenCalledTimes(1);
    expect(host.calendarCommit).toHaveBeenCalledWith({
      coverage: [
        { kind: 'timed', start: gapStart, end: args.endMs },
        {
          kind: 'allDay',
          start: epochDay('2026-10-08'),
          end: epochDay('2026-10-12'),
        },
      ],
      watermark: {
        kind: 'merge',
        links: [
          { linkId: 'link-1', seq: '7' },
          { linkId: 'link-2', seq: '4' },
        ],
      },
    });
    expect(host.calendarRange).toHaveBeenCalledTimes(2);
    expect(data?.items).toHaveLength(1);
    expect(data?.syncStatus).toBe(CalendarSyncStatus.syncing);
    expect(latestCalendarSyncStatus()).toBe(CalendarSyncStatus.syncing);
  });

  it('does not commit coverage when a page fails', async () => {
    const host = fakeHost([
      range({
        gaps: [{ kind: 'timed', start: 0, end: DAY_MS }],
      }),
    ]);
    const fetchPage = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(readCalendarRange(host, week, { fetchPage })).rejects.toThrow(
      'offline'
    );
    expect(host.calendarCommit).not.toHaveBeenCalled();
  });

  it('reports an unsupported host so the caller reads from REST', async () => {
    const host = fakeHost([{ kind: 'unsupported' }]);
    await expect(readCalendarRange(host, week)).resolves.toEqual({
      kind: 'unsupported',
    });
  });

  it('sends viewports to REST while a starting cache has not answered', async () => {
    let answer: (result: CalendarRangeCacheResult) => void = () => {};
    const host = fakeHost([
      range({ occurrenceKeys: ['GraphqlCalendarOccurrence:event-1:a'] }),
    ]);
    host.calendarRange.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );

    await expect(
      readCalendarRange(host, week, { headStartMs: 5 })
    ).resolves.toEqual({ kind: 'not-ready' });
    await expect(
      readCalendarRange(host, week, { headStartMs: 5 })
    ).resolves.toEqual({ kind: 'not-ready' });
    expect(host.calendarRange).toHaveBeenCalledTimes(1);
    expect(calendarCacheAnswered(host)).toBe(false);

    answer(range({}));
    await vi.waitFor(() => expect(calendarCacheAnswered(host)).toBe(true));
    const data = await readData(host, week, { headStartMs: 5 });
    expect(data.items).toHaveLength(1);
  });

  it('asks again after a starting cache fails its first read', async () => {
    const host = fakeHost([
      range({ occurrenceKeys: ['GraphqlCalendarOccurrence:event-1:a'] }),
    ]);
    host.calendarRange.mockRejectedValueOnce(new Error('cache worker timeout'));

    await expect(readCalendarRange(host, week)).rejects.toThrow(
      'cache worker timeout'
    );
    const data = await readData(host, week);
    expect(data.items).toHaveLength(1);
    expect(calendarCacheAnswered(host)).toBe(true);
  });
});

describe('calendarGapWindows', () => {
  it('fetches timed gaps with their local dates', () => {
    const start = new Date(2026, 9, 5, 10).getTime();
    const end = new Date(2026, 9, 5, 14).getTime();
    expect(calendarGapWindows([{ kind: 'timed', start, end }])).toEqual([
      {
        input: {
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          startDate: '2026-10-05',
          endDate: '2026-10-06',
        },
        coverage: [
          { kind: 'timed', start, end },
          {
            kind: 'allDay',
            start: epochDay('2026-10-05'),
            end: epochDay('2026-10-06'),
          },
        ],
      },
    ]);
  });

  it('fetches all-day gaps no timed window spans at local midnight', () => {
    const day = epochDay('2026-10-20');
    const windows = calendarGapWindows([
      { kind: 'allDay', start: day, end: day + 2 },
    ]);
    expect(windows).toEqual([
      {
        input: {
          start: new Date(2026, 9, 20).toISOString(),
          end: new Date(2026, 9, 22).toISOString(),
          startDate: '2026-10-20',
          endDate: '2026-10-22',
        },
        coverage: [
          {
            kind: 'timed',
            start: new Date(2026, 9, 20).getTime(),
            end: new Date(2026, 9, 22).getTime(),
          },
          { kind: 'allDay', start: day, end: day + 2 },
        ],
      },
    ]);
    const timedStart = new Date(2026, 9, 20).getTime();
    expect(
      calendarGapWindows([
        { kind: 'timed', start: timedStart, end: timedStart + 2 * DAY_MS },
        { kind: 'allDay', start: day, end: day + 2 },
      ])
    ).toHaveLength(1);
  });
});

describe('lowestWatermark', () => {
  it('keeps the lowest sequence each link reported', () => {
    expect(
      lowestWatermark([
        [{ linkId: 'a', seq: '18446744073709551' }],
        [
          { linkId: 'a', seq: '9' },
          { linkId: 'b', seq: '3' },
        ],
      ])
    ).toEqual([
      { linkId: 'a', seq: '9' },
      { linkId: 'b', seq: '3' },
    ]);
  });
});

describe('fetchCalendarWindow', () => {
  it('keeps the status of the later request when an earlier one finishes last', async () => {
    const host = fakeHost([]);
    const window = calendarGapWindows([
      { kind: 'timed', start: weekStart.getTime(), end: weekEnd.getTime() },
    ])[0]!;
    let finishEarlier!: () => void;
    const earlierDone = new Promise<void>((resolve) => {
      finishEarlier = resolve;
    });
    const earlier = fetchCalendarWindow(host, window, async () => {
      await earlierDone;
      return page({ syncStatus: 'READY' });
    });
    await fetchCalendarWindow(host, window, async () =>
      page({ syncStatus: 'SYNCING' })
    );
    finishEarlier();
    await earlier;
    expect(latestCalendarSyncStatus()).toBe(CalendarSyncStatus.syncing);
  });
});
