import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarKeys } from '../../keys';
import {
  invalidateCalendarOccurrences,
  syncCalendarOccurrences,
} from '../../occurrences';
import {
  type CalendarSyncController,
  setActiveCalendarSyncController,
} from '../sync-controller';

const invalidateQueriesMock = vi.hoisted(() => vi.fn());

vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: invalidateQueriesMock },
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
  getGraphqlSoupCacheHost: vi.fn(),
  graphqlCacheEnabled: () => false,
}));

describe('invalidateCalendarOccurrences', () => {
  afterEach(() => {
    setActiveCalendarSyncController(undefined);
    vi.clearAllMocks();
  });

  it('applies the delta before cache-backed viewports reread', async () => {
    const order: string[] = [];
    const runDelta = vi.fn(async () => {
      order.push('delta');
    });
    invalidateQueriesMock.mockImplementation(async () => {
      order.push('invalidate');
    });
    setActiveCalendarSyncController({
      answering: () => true,
      runDelta,
    } as unknown as CalendarSyncController);

    await invalidateCalendarOccurrences();

    expect(order).toEqual(['delta', 'invalidate']);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: calendarKeys.occurrences._def,
    });
  });

  it('refetches without waiting on a cache that is still starting', async () => {
    const runDelta = vi.fn(() => new Promise<void>(() => {}));
    setActiveCalendarSyncController({
      answering: () => false,
      runDelta,
    } as unknown as CalendarSyncController);

    await invalidateCalendarOccurrences();

    expect(runDelta).not.toHaveBeenCalled();
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
  });

  it('still refetches when the delta fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setActiveCalendarSyncController({
      answering: () => true,
      runDelta: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as CalendarSyncController);

    await invalidateCalendarOccurrences();

    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('syncs a starting cache before an expected read refetches', async () => {
    const order: string[] = [];
    let ready!: () => void;
    const runDelta = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          ready = () => {
            order.push('delta');
            resolve();
          };
        })
    );
    invalidateQueriesMock.mockImplementation(async () => {
      order.push('invalidate');
    });
    setActiveCalendarSyncController({
      answering: () => false,
      runDelta,
    } as unknown as CalendarSyncController);

    const sync = syncCalendarOccurrences();
    await Promise.resolve();
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
    ready();
    await sync;

    expect(order).toEqual(['delta', 'invalidate']);
  });

  it('refetches the REST viewports when there is no cache to sync', async () => {
    await syncCalendarOccurrences();

    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: calendarKeys.occurrences._def,
    });
  });

  it('nests cache-backed keys under the REST prefix', () => {
    const range = {
      start: '2026-10-05T00:00:00.000Z',
      end: '2026-10-12T00:00:00.000Z',
      startDate: '2026-10-05',
      endDate: '2026-10-12',
    };
    const rest = calendarKeys.occurrences('user-1', range).queryKey;
    const graphql = calendarKeys.occurrences('user-1', range)._ctx.graphql
      .queryKey;
    expect(graphql.slice(0, rest.length)).toEqual([...rest]);
    expect(
      calendarKeys.visibleCalendars._ctx.graphql.queryKey.slice(0, 2)
    ).toEqual([...calendarKeys.visibleCalendars.queryKey]);
  });
});
