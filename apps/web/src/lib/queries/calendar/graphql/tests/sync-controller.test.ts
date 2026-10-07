import type {
  CalendarCommitArgs,
  CalendarRangeCacheResult,
} from '@graphql-cache/index';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CalendarChangesPage,
  CalendarSyncController,
} from '../sync-controller';
import { graphqlEvent, graphqlOccurrence } from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));

const syncState = (
  watermark: Array<{ linkId: string; seq: string }> | null
): CalendarRangeCacheResult => ({
  kind: 'range',
  revision: '1' as never,
  occurrenceKeys: [],
  gaps: [],
  freshness: 'fresh',
  uncertainEventKeys: [],
  optimistic: false,
  watermark,
});

const changes = (
  overrides: Partial<CalendarChangesPage> = {}
): CalendarChangesPage => ({
  events: [],
  deletedEventIds: [],
  calendars: [],
  deletedCalendarIds: [],
  newWatermark: [{ linkId: 'link-1', seq: '5' }],
  hasMore: false,
  resetRequired: false,
  ...overrides,
});

function setup(
  pages: CalendarChangesPage[],
  watermark: Array<{ linkId: string; seq: string }> | null = [
    { linkId: 'link-1', seq: '1' },
    { linkId: 'link-2', seq: '7' },
  ]
) {
  const host = {
    calendarRange: vi.fn(async () => syncState(watermark)),
    calendarCommit: vi.fn(async (_commit: CalendarCommitArgs) => ({
      kind: 'committed' as const,
      revision: '2' as never,
      changed: [],
    })),
  };
  const fetchChanges = vi.fn(async () => {
    const page = pages.shift();
    if (!page) throw new Error('unexpected delta page');
    return page;
  });
  const refetchCalendars = vi.fn(async () => undefined);
  const controller = new CalendarSyncController(host, {
    fetchChanges,
    refetchCalendars,
    debounceMs: 50,
  });
  return { host, fetchChanges, refetchCalendars, controller };
}

describe('CalendarSyncController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('replaces changed events, deletes removals, and advances the watermark', async () => {
    const { host, fetchChanges, refetchCalendars, controller } = setup([
      changes({
        events: [
          {
            event: graphqlEvent(),
            occurrences: [graphqlOccurrence()],
          },
        ],
        deletedEventIds: ['event-2'],
        deletedCalendarIds: ['calendar-9'],
      }),
    ]);

    await controller.runDelta();

    expect(fetchChanges).toHaveBeenCalledWith([
      { linkId: 'link-1', seq: '1' },
      { linkId: 'link-2', seq: '7' },
    ]);
    expect(host.calendarCommit).toHaveBeenCalledWith({
      replacedEvents: [
        {
          eventKey: 'GraphqlCalendarEvent:event-1',
          occurrenceKeys: [
            'GraphqlCalendarOccurrence:event-1:2026-10-06T09:00:00+00:00',
          ],
        },
      ],
      deletedEventKeys: ['GraphqlCalendarEvent:event-2'],
      deletedCalendarKeys: ['GraphqlCalendar:calendar-9'],
      removedLinkIds: ['link-2'],
      watermark: {
        kind: 'advance',
        since: [
          { linkId: 'link-1', seq: '1' },
          { linkId: 'link-2', seq: '7' },
        ],
        to: [{ linkId: 'link-1', seq: '5' }],
      },
      freshness: 'fresh',
    });
    expect(refetchCalendars).toHaveBeenCalledTimes(1);
  });

  it('follows hasMore from each page watermark and marks fresh at the end', async () => {
    const { host, fetchChanges, refetchCalendars, controller } = setup(
      [
        changes({
          hasMore: true,
          newWatermark: [{ linkId: 'link-1', seq: '3' }],
        }),
        changes({ newWatermark: [{ linkId: 'link-1', seq: '6' }] }),
      ],
      [{ linkId: 'link-1', seq: '1' }]
    );

    await controller.runDelta();

    expect(fetchChanges.mock.calls).toEqual([
      [[{ linkId: 'link-1', seq: '1' }]],
      [[{ linkId: 'link-1', seq: '3' }]],
    ]);
    const commits = host.calendarCommit.mock.calls.map(([commit]) => commit);
    expect(commits[0]).not.toHaveProperty('freshness');
    expect(commits[0]?.watermark).toEqual({
      kind: 'advance',
      since: [{ linkId: 'link-1', seq: '1' }],
      to: [{ linkId: 'link-1', seq: '3' }],
    });
    expect(commits[1]).toMatchObject({
      freshness: 'fresh',
      watermark: {
        kind: 'advance',
        since: [{ linkId: 'link-1', seq: '3' }],
        to: [{ linkId: 'link-1', seq: '6' }],
      },
    });
    expect(refetchCalendars).not.toHaveBeenCalled();
  });

  it('resets the cache with the server watermark when required', async () => {
    const { host, refetchCalendars, controller } = setup([
      changes({
        resetRequired: true,
        newWatermark: [{ linkId: 'link-3', seq: '40' }],
      }),
    ]);

    await controller.runDelta();

    expect(host.calendarCommit).toHaveBeenCalledTimes(1);
    expect(host.calendarCommit).toHaveBeenCalledWith({
      reset: true,
      watermark: { kind: 'merge', links: [{ linkId: 'link-3', seq: '40' }] },
    });
    expect(refetchCalendars).toHaveBeenCalledTimes(1);
  });

  it('skips the delta until a page fetch establishes a watermark', async () => {
    for (const watermark of [null, []]) {
      const { host, fetchChanges, controller } = setup([], watermark);
      await controller.runDelta();
      expect(fetchChanges).not.toHaveBeenCalled();
      expect(host.calendarCommit).not.toHaveBeenCalled();
    }
  });

  it('debounces pokes into one run', async () => {
    const { fetchChanges, controller } = setup([changes()]);
    controller.markStale('poke');
    controller.markStale('poke');
    controller.markStale('reconnect');
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchChanges).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(fetchChanges).toHaveBeenCalledTimes(1);
  });

  it('runs once more for a request made during a run', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchChanges, controller } = setup([changes(), changes()]);
    fetchChanges.mockImplementationOnce(async () => {
      await gate;
      return changes();
    });
    const first = controller.runDelta();
    const second = controller.runDelta();
    expect(second).toBe(first);
    release();
    await first;
    expect(fetchChanges).toHaveBeenCalledTimes(2);
  });

  it('stops scheduling after disposal', async () => {
    const { fetchChanges, controller } = setup([changes()]);
    controller.markStale('poke');
    controller.dispose();
    await vi.runAllTimersAsync();
    await controller.runDelta();
    expect(fetchChanges).not.toHaveBeenCalled();
  });
});
