import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type {
  CalendarCommitArgs,
  CalendarRangeCacheResult,
} from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { type Span, Telemetry } from '@macro-inc/observability';
import { CalendarsDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { createClient, fetchExchange } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordCalendarRestAnswer } from '../readiness';
import {
  type CalendarChangesPage,
  CalendarSyncController,
  DELTA_RETRY_BASE_MS,
  MAX_DELTA_RETRIES,
  refetchCalendarList,
} from '../sync-controller';
import { graphqlEvent, graphqlOccurrence } from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));

it('refreshes the calendar list while the visible list is reading the cache', async () => {
  const cacheReadStarted = Promise.withResolvers<void>();
  const finishCacheRead = Promise.withResolvers<void>();
  const emptyList = { user: { id: 'viewer', calendars: [] } };
  const discoveredList = {
    user: { id: 'viewer', calendars: [{ id: 'new-calendar' }] },
  };
  const host = createNoopCacheHost();
  const read = vi.spyOn(host, 'readQuery').mockImplementation(async () => {
    cacheReadStarted.resolve();
    await finishCacheRead.promise;
    return { kind: 'hit', data: emptyList };
  });
  const write = vi.spyOn(host, 'writeQuery');
  const fetch = vi.fn(async () => Response.json({ data: discoveredList }));
  const client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [normalizedCacheExchange(host), fetchExchange],
    fetch,
  });
  vi.mocked(getGraphqlSoupClient).mockReturnValue(client);

  const visible = client.query(CalendarsDocument, {}).toPromise();
  await cacheReadStarted.promise;
  const refreshed = refetchCalendarList();
  finishCacheRead.resolve();

  await expect(refreshed).resolves.toEqual(discoveredList);
  await expect(visible).resolves.toMatchObject({ data: emptyList });
  expect(read).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ data: discoveredList })
  );
});

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

/** Records the attributes of each span the controller opens. */
function recordSpans() {
  const spans: {
    name: string;
    attributes: Record<string, unknown>;
    errors: unknown[];
  }[] = [];
  vi.spyOn(Telemetry, 'span').mockImplementation(((
    name: string,
    run: (span: Pick<Span, 'setAttr' | 'error'>) => unknown
  ) => {
    const recorded = {
      name,
      attributes: {} as Record<string, unknown>,
      errors: [] as unknown[],
    };
    spans.push(recorded);
    return run({
      setAttr: (key: string, value: unknown) => {
        recorded.attributes[key] = value;
      },
      error: (error: unknown) => {
        recorded.errors.push(error);
      },
    } as Pick<Span, 'setAttr' | 'error'>);
  }) as unknown as typeof Telemetry.span);
  return spans;
}

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
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs the requested new-generation pass after an old commit is rejected', async () => {
    const { host, fetchChanges, controller } = setup([changes()]);
    const started = Promise.withResolvers<void>();
    const first = Promise.withResolvers<CalendarChangesPage>();
    fetchChanges.mockImplementationOnce(() => {
      started.resolve();
      return first.promise;
    });
    host.calendarCommit.mockRejectedValueOnce(new StaleCacheAuthorityError());
    const running = controller.runDelta();
    await started.promise;
    const rerun = controller.runDelta();
    first.resolve(changes());
    await Promise.all([running, rerun]);
    expect(fetchChanges).toHaveBeenCalledTimes(2);
    expect(host.calendarCommit).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('preserves the delta request generation through a later index commit', async () => {
    const { host, fetchChanges, controller } = setup([]);
    const entered = Promise.withResolvers<void>();
    const response = Promise.withResolvers<CalendarChangesPage>();
    fetchChanges.mockImplementationOnce(() => {
      entered.resolve();
      return response.promise;
    });
    const generation = cacheSessionGeneration.capture();
    const syncing = controller.runDelta();
    await entered.promise;
    await cacheSessionGeneration.transition(async () => {});
    response.resolve(changes());
    await syncing;
    expect(host.calendarCommit).toHaveBeenCalledWith(
      expect.anything(),
      generation
    );
    controller.dispose();
  });

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
    expect(host.calendarCommit).toHaveBeenCalledWith(
      {
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
      },
      expect.any(String)
    );
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
    expect(host.calendarCommit).toHaveBeenCalledWith(
      {
        reset: true,
        watermark: { kind: 'merge', links: [{ linkId: 'link-3', seq: '40' }] },
      },
      expect.any(String)
    );
    expect(refetchCalendars).toHaveBeenCalledTimes(1);
  });

  it('skips the delta until a page fetch establishes a watermark', async () => {
    const { host, fetchChanges, controller } = setup([], null);
    await controller.runDelta();
    expect(fetchChanges).not.toHaveBeenCalled();
    expect(host.calendarCommit).not.toHaveBeenCalled();
  });

  it('keeps rows cached with no inbox while the server still lists none', async () => {
    const { host, fetchChanges, refetchCalendars, controller } = setup(
      [changes({ newWatermark: [] })],
      []
    );
    await controller.runDelta();
    expect(fetchChanges).toHaveBeenCalledExactlyOnceWith([]);
    expect(host.calendarCommit).not.toHaveBeenCalled();
    expect(refetchCalendars).not.toHaveBeenCalled();
  });

  it('resets rows cached with no inbox once the server lists one', async () => {
    const spans = recordSpans();
    const { host, fetchChanges, refetchCalendars, controller } = setup(
      [changes({ newWatermark: [{ linkId: 'link-9', seq: '12' }] })],
      []
    );
    await controller.runDelta();
    expect(fetchChanges).toHaveBeenCalledExactlyOnceWith([]);
    expect(host.calendarCommit).toHaveBeenCalledExactlyOnceWith(
      {
        reset: true,
        watermark: { kind: 'merge', links: [{ linkId: 'link-9', seq: '12' }] },
      },
      expect.any(String)
    );
    expect(refetchCalendars).toHaveBeenCalledOnce();
    expect(spans.at(-1)).toMatchObject({
      name: 'calendar.delta_sync',
      attributes: {
        'calendar.delta.reset': 'first_link',
        'calendar.delta.links': 0,
      },
    });
  });

  it('tells its owner when a delta dropped the cached calendar', async () => {
    const onReset = vi.fn();
    const host = {
      calendarRange: vi.fn(async () => syncState([])),
      calendarCommit: vi.fn(async () => ({
        kind: 'committed' as const,
        revision: '2' as never,
        changed: [],
      })),
    };
    const controller = new CalendarSyncController(host, {
      fetchChanges: async () =>
        changes({ newWatermark: [{ linkId: 'link-9', seq: '12' }] }),
      refetchCalendars: async () => undefined,
      onReset,
    });
    await controller.runDelta();
    expect(onReset).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('marks a failed pass on its span', async () => {
    const spans = recordSpans();
    const { fetchChanges, controller } = setup([]);
    fetchChanges.mockRejectedValueOnce(new Error('offline'));
    await expect(controller.runDelta()).rejects.toThrow('offline');
    expect(spans.at(-1)?.errors).toHaveLength(1);
    expect(spans.at(-1)?.attributes['calendar.delta.links']).toBe(2);
    controller.dispose();
  });

  it('names a reset for a link the cache never tracked', async () => {
    const spans = recordSpans();
    const { controller } = setup([
      changes({
        resetRequired: true,
        newWatermark: [
          { linkId: 'link-1', seq: '5' },
          { linkId: 'link-3', seq: '40' },
        ],
      }),
    ]);
    await controller.runDelta();
    expect(spans.at(-1)?.attributes).toMatchObject({
      'calendar.delta.reset': 'new_link',
      'calendar.delta.pages': 1,
    });
  });

  it('names a reset past the server retention', async () => {
    const spans = recordSpans();
    const { controller } = setup(
      [
        changes({
          resetRequired: true,
          newWatermark: [{ linkId: 'link-1', seq: '90' }],
        }),
      ],
      [{ linkId: 'link-1', seq: '1' }]
    );
    await controller.runDelta();
    expect(spans.at(-1)?.attributes).toMatchObject({
      'calendar.delta.reset': 'retention',
    });
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

  it('schedules another run when the page cap leaves changes behind', async () => {
    const pages = Array.from({ length: 51 }, (_, index) =>
      changes({
        newWatermark: [{ linkId: 'link-1', seq: String(index + 2) }],
        hasMore: index < 50,
      })
    );
    const { host, fetchChanges, controller } = setup(pages, [
      { linkId: 'link-1', seq: '1' },
    ]);
    await controller.runDelta();
    expect(fetchChanges).toHaveBeenCalledTimes(50);
    expect(
      host.calendarCommit.mock.calls.at(-1)?.[0].freshness
    ).toBeUndefined();
    await vi.runAllTimersAsync();
    expect(fetchChanges).toHaveBeenCalledTimes(51);
    expect(host.calendarCommit.mock.calls.at(-1)?.[0]).toMatchObject({
      watermark: {
        kind: 'advance',
        to: [{ linkId: 'link-1', seq: '52' }],
      },
      freshness: 'fresh',
    });
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

describe('CalendarSyncController catching up a read', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets a synced cache answer without another delta', async () => {
    const { fetchChanges, controller } = setup([changes()]);
    await controller.runDelta();

    await expect(controller.catchUp()).resolves.toBe('current');
    expect(fetchChanges).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('keeps a cache no REST read overtook answering after a failed delta', async () => {
    const { fetchChanges, controller } = setup([changes()]);
    await controller.runDelta();
    fetchChanges.mockRejectedValueOnce(new Error('offline'));
    await expect(controller.runDelta()).rejects.toThrow('offline');

    expect(controller.caughtUp()).toBe(true);
    await expect(controller.catchUp()).resolves.toBe('current');
    expect(fetchChanges).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('runs one delta before answering after REST showed a viewport', async () => {
    const { fetchChanges, controller } = setup([changes(), changes()]);
    await controller.runDelta();
    recordCalendarRestAnswer();

    expect(controller.caughtUp()).toBe(false);
    await expect(controller.catchUp()).resolves.toBe('held');
    await expect(controller.catchUp()).resolves.toBe('current');
    expect(fetchChanges).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('runs a joined pass again when it read the server before the REST answer', async () => {
    const { fetchChanges, controller } = setup([changes(), changes()]);
    const started = Promise.withResolvers<void>();
    const first = Promise.withResolvers<CalendarChangesPage>();
    fetchChanges.mockImplementationOnce(() => {
      started.resolve();
      return first.promise;
    });
    const running = controller.runDelta();
    await started.promise;
    recordCalendarRestAnswer();
    const read = controller.catchUp();
    first.resolve(changes());

    await expect(read).resolves.toBe('held');
    await running;
    expect(fetchChanges).toHaveBeenCalledTimes(2);
    expect(controller.caughtUp()).toBe(true);
    controller.dispose();
  });

  it('joins a pass without another when it reads the server after the REST answer', async () => {
    const { host, fetchChanges, controller } = setup([changes()]);
    const state = Promise.withResolvers<CalendarRangeCacheResult>();
    host.calendarRange.mockImplementationOnce(() => state.promise);
    const running = controller.runDelta();
    recordCalendarRestAnswer();
    const read = controller.catchUp();
    state.resolve(
      syncState([
        { linkId: 'link-1', seq: '1' },
        { linkId: 'link-2', seq: '7' },
      ])
    );

    await expect(read).resolves.toBe('held');
    await running;
    expect(fetchChanges).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('reads as behind when the delta stops at the page cap', async () => {
    const pages = Array.from({ length: 51 }, (_, index) =>
      changes({
        newWatermark: [{ linkId: 'link-1', seq: String(index + 2) }],
        hasMore: index < 50,
      })
    );
    const { fetchChanges, controller } = setup(pages, [
      { linkId: 'link-1', seq: '1' },
    ]);
    recordCalendarRestAnswer();

    await expect(controller.catchUp()).resolves.toBe('behind');
    expect(fetchChanges).toHaveBeenCalledTimes(50);
    await vi.runAllTimersAsync();
    expect(fetchChanges).toHaveBeenCalledTimes(51);
    await expect(controller.catchUp()).resolves.toBe('current');
    controller.dispose();
  });

  it('reads as behind after a failed delta until its retry succeeds', async () => {
    const { fetchChanges, controller } = setup([changes()]);
    fetchChanges.mockRejectedValueOnce(new Error('owner handoff'));
    recordCalendarRestAnswer();
    await expect(controller.runDelta()).rejects.toThrow('owner handoff');

    await expect(controller.catchUp()).resolves.toBe('behind');
    expect(fetchChanges).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(DELTA_RETRY_BASE_MS);
    expect(fetchChanges).toHaveBeenCalledTimes(2);
    await expect(controller.catchUp()).resolves.toBe('current');
    controller.dispose();
  });

  it('labels a read that joins the scheduled retry as retried', async () => {
    const { fetchChanges, controller } = setup([]);
    fetchChanges.mockRejectedValueOnce(new Error('owner handoff'));
    recordCalendarRestAnswer();
    await expect(controller.runDelta()).rejects.toThrow('owner handoff');
    const retried = Promise.withResolvers<CalendarChangesPage>();
    fetchChanges.mockImplementationOnce(() => retried.promise);

    await vi.advanceTimersByTimeAsync(DELTA_RETRY_BASE_MS);
    const read = controller.catchUp();
    retried.resolve(changes());

    await expect(read).resolves.toBe('retried');
    controller.dispose();
  });

  it('retries a failed delta from a read once its backoff has passed', async () => {
    const { fetchChanges, controller } = setup([changes()]);
    fetchChanges.mockRejectedValueOnce(new Error('owner handoff'));
    recordCalendarRestAnswer();
    await expect(controller.runDelta()).rejects.toThrow('owner handoff');
    // A hidden tab can hold the retry timer past its time.
    vi.setSystemTime(Date.now() + DELTA_RETRY_BASE_MS);

    await expect(controller.catchUp()).resolves.toBe('retried');
    expect(fetchChanges).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect(fetchChanges).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('stops retrying with backoff after a few failed deltas', async () => {
    const { fetchChanges, controller } = setup([]);
    fetchChanges.mockRejectedValue(new Error('owner handoff'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordCalendarRestAnswer();
    await expect(controller.runDelta()).rejects.toThrow('owner handoff');

    let waited = 0;
    for (let retry = 1; retry <= MAX_DELTA_RETRIES; retry += 1) {
      const delay = DELTA_RETRY_BASE_MS * 2 ** (retry - 1);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetchChanges).toHaveBeenCalledTimes(retry);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchChanges).toHaveBeenCalledTimes(retry + 1);
      waited += delay;
    }
    await vi.advanceTimersByTimeAsync(waited * 10);
    expect(fetchChanges).toHaveBeenCalledTimes(MAX_DELTA_RETRIES + 1);
    await expect(controller.catchUp()).resolves.toBe('behind');
    expect(fetchChanges).toHaveBeenCalledTimes(MAX_DELTA_RETRIES + 1);
    warn.mockRestore();
    controller.dispose();
  });

  it('lets reads try the cache only while a delta can bring it forward', async () => {
    const { fetchChanges, controller } = setup([changes()]);
    fetchChanges.mockRejectedValueOnce(new Error('owner handoff'));
    expect(controller.canCatchUp()).toBe(true);
    recordCalendarRestAnswer();
    expect(controller.canCatchUp()).toBe(true);
    await expect(controller.runDelta()).rejects.toThrow('owner handoff');

    expect(controller.canCatchUp()).toBe(false);
    vi.setSystemTime(Date.now() + DELTA_RETRY_BASE_MS);
    expect(controller.canCatchUp()).toBe(true);
    await expect(controller.catchUp()).resolves.toBe('retried');
    expect(controller.canCatchUp()).toBe(true);
    controller.dispose();
  });

  it('does not count a run cut short by disposal as caught up', async () => {
    const { host, controller } = setup([changes()]);
    const state = Promise.withResolvers<CalendarRangeCacheResult>();
    host.calendarRange.mockImplementationOnce(() => state.promise);
    recordCalendarRestAnswer();
    const read = controller.catchUp();
    controller.dispose();
    state.resolve(syncState([{ linkId: 'link-1', seq: '1' }]));

    await expect(read).resolves.toBe('behind');
  });
});
