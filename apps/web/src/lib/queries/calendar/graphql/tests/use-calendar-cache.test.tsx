import { render } from '@solidjs/testing-library';
import { onlineManager } from '@tanstack/query-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCalendarCache } from '../use-calendar-cache';

const mocks = vi.hoisted(() => ({
  runCalendarBackfill: vi.fn<() => Promise<void>>(),
}));

const host = { onCacheGenerationChanged: () => () => {} };

vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: () => () => true,
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@service-storage/graphql-soup', () => ({
  subscribeGraphqlSoupReconnected: () => () => {},
}));
vi.mock('../backfill', () => ({
  runCalendarBackfill: mocks.runCalendarBackfill,
}));
vi.mock('../flag', () => ({ useGraphqlCalendarHost: () => () => host }));
vi.mock('../mutations', () => ({
  trackCalendarCreateSettlements: () => () => {},
}));
vi.mock('../range', () => ({
  beginCalendarSyncStatusSample: vi.fn(),
  fetchCalendarOccurrencePage: vi.fn(),
  latestCalendarSyncStatus: () => 'ready',
  recordCalendarSyncStatus: vi.fn(),
}));
vi.mock('../sync-controller', () => ({
  activeCalendarSyncController: () => undefined,
  setActiveCalendarSyncController: () => {},
  CalendarSyncController: class {
    markStale() {}
    dispose() {}
  },
}));

function CalendarCacheRunner() {
  useCalendarCache(() => true);
  return null;
}

describe('useCalendarCache backfill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    onlineManager.setOnline(true);
    mocks.runCalendarBackfill
      .mockReset()
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a failed backfill instead of stopping for the session', async () => {
    const rendered = render(() => <CalendarCacheRunner />);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.runCalendarBackfill).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(mocks.runCalendarBackfill).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(600_000);
      expect(mocks.runCalendarBackfill).toHaveBeenCalledTimes(2);
    } finally {
      rendered.unmount();
    }
  });

  it('retries as soon as the device comes back online', async () => {
    const rendered = render(() => <CalendarCacheRunner />);
    try {
      await vi.advanceTimersByTimeAsync(0);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.runCalendarBackfill).toHaveBeenCalledTimes(2);
    } finally {
      rendered.unmount();
    }
  });

  it('stops retrying once unmounted', async () => {
    const rendered = render(() => <CalendarCacheRunner />);
    await vi.advanceTimersByTimeAsync(0);
    rendered.unmount();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.runCalendarBackfill).toHaveBeenCalledOnce();
  });
});
