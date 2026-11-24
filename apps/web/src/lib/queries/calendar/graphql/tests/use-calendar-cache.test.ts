import type { CacheHost } from '@graphql-cache/index';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarKeys } from '../../keys';
import {
  beginCalendarSyncStatusSample,
  type CalendarOccurrencePage,
  latestCalendarSyncStatus,
  recordCalendarSyncStatus,
} from '../range';
import { useCalendarCache } from '../use-calendar-cache';

const mocks = vi.hoisted(() => ({
  fetchPage: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
  markStale: vi.fn(),
  trackCreates: vi.fn(),
  untrackCreates: vi.fn(),
  activeController: undefined as unknown,
}));

vi.mock('../range', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../range')>()),
  fetchCalendarOccurrencePage: mocks.fetchPage,
}));
vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: mocks.invalidateQueries },
}));
vi.mock('../flag', () => ({ useGraphqlCalendarHost: () => host }));
vi.mock('../sync-controller', () => ({
  CalendarSyncController: class {
    markStale = mocks.markStale;
    dispose() {}
  },
  activeCalendarSyncController: () => mocks.activeController,
  setActiveCalendarSyncController: (controller: unknown) => {
    mocks.activeController = controller;
  },
}));
vi.mock('../mutations', () => ({
  trackCalendarCreateSettlements: mocks.trackCreates,
}));
vi.mock('../backfill', () => ({ runCalendarBackfill: vi.fn() }));
vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: () => () => false,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
  subscribeGraphqlSoupReconnected: () => () => {},
}));

const POLL_MS = 60_000;
const cacheHost = (): CacheHost =>
  ({ onCacheGenerationChanged: () => () => {} }) as unknown as CacheHost;
const [host, setHost] = createSignal<CacheHost | undefined>(cacheHost());

const page = (
  syncStatus: CalendarOccurrencePage['syncStatus']
): CalendarOccurrencePage => ({
  nodes: [],
  hasNextPage: false,
  endCursor: null,
  syncStatus,
  watermark: [],
});

let dispose: (() => void) | undefined;
const mount = () => {
  dispose = createRoot((done) => {
    useCalendarCache(() => true);
    return done;
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.trackCreates.mockReturnValue(mocks.untrackCreates);
  setHost(cacheHost());
  // The status is module state: every test starts from the default.
  recordCalendarSyncStatus(
    CalendarSyncStatus.ready,
    beginCalendarSyncStatusSample()
  );
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  mocks.activeController = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useCalendarCache sync status', () => {
  it('reads the status on load though every viewport is cached', async () => {
    mocks.fetchPage.mockResolvedValue(page('SYNCING'));
    mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
    expect(mocks.fetchPage).toHaveBeenCalledWith(
      expect.objectContaining({ first: 1 })
    );
    expect(latestCalendarSyncStatus()).toBe(CalendarSyncStatus.syncing);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: calendarKeys.occurrences._def,
    });
  });

  it('polls while the server says syncing and stops once it is ready', async () => {
    mocks.fetchPage
      .mockResolvedValueOnce(page('SYNCING'))
      .mockResolvedValueOnce(page('SYNCING'))
      .mockResolvedValue(page('READY'));
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(latestCalendarSyncStatus()).toBe(CalendarSyncStatus.syncing);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(2);
    expect(latestCalendarSyncStatus()).toBe(CalendarSyncStatus.syncing);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(3);
    expect(latestCalendarSyncStatus()).toBe(CalendarSyncStatus.ready);
    // Syncing, then ready: each change rereads the shown viewports once.
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(3);
  });

  it('drops a status read that ends after its controller is retired', async () => {
    let answer: (value: CalendarOccurrencePage) => void = () => {};
    mocks.fetchPage.mockReturnValueOnce(
      new Promise<CalendarOccurrencePage>((resolve) => {
        answer = resolve;
      })
    );
    mount();
    await vi.advanceTimersByTimeAsync(0);
    dispose?.();
    dispose = undefined;

    answer(page('SYNCING'));
    await vi.advanceTimersByTimeAsync(0);
    expect(latestCalendarSyncStatus()).toBe(CalendarSyncStatus.ready);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it('reads it again on coming back online', async () => {
    mocks.fetchPage.mockResolvedValue(page('READY'));
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();

    mocks.fetchPage.mockResolvedValue(page('SYNCING'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(2);
    expect(mocks.markStale).toHaveBeenCalledWith('online');
    expect(latestCalendarSyncStatus()).toBe(CalendarSyncStatus.syncing);
  });
});

it('keeps hearing creates settle while the cache is paused', () => {
  mocks.fetchPage.mockResolvedValue(page('READY'));
  const paused = host();
  mount();
  expect(mocks.trackCreates).toHaveBeenCalledExactlyOnceWith(paused);

  setHost(undefined);
  expect(mocks.untrackCreates).not.toHaveBeenCalled();
  setHost(paused);
  expect(mocks.trackCreates).toHaveBeenCalledOnce();

  const next = cacheHost();
  setHost(next);
  expect(mocks.untrackCreates).toHaveBeenCalledOnce();
  expect(mocks.trackCreates).toHaveBeenLastCalledWith(next);
});
