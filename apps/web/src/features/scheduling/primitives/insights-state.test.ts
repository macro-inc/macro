import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { Booking } from '../core/types';
import { createInsightsState } from './insights-state';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function booking(id: string): Booking {
  return {
    id,
    eventTypeId: 'event',
    title: 'Discovery call',
    name: 'Guest',
    email: 'guest@example.com',
    startsAt: '2026-03-08T14:00:00Z',
    endsAt: '2026-03-08T14:30:00Z',
    timeZone: 'America/New_York',
    hosts: ['host'],
    status: 'confirmed',
    location: '',
    answers: {},
    attendance: 'unknown',
    rescheduleCount: 0,
    rescheduledAt: null,
  };
}

describe('insights loading state', () => {
  it('keeps the newest report when an older date-range request resolves later', async () => {
    const first = deferred<Booking[]>();
    const second = deferred<Booking[]>();
    const loadInsights = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const owned = createRoot((dispose) => ({
      dispose,
      state: createInsightsState({ loadInsights }, 'America/New_York'),
    }));
    const oldRequest = owned.state.load('2026-03-01', '2026-03-07');
    const currentRequest = owned.state.load('2026-03-08', '2026-03-14');
    second.resolve([booking('current')]);
    await currentRequest;
    first.resolve([booking('old')]);
    await oldRequest;
    expect(owned.state.range()).toEqual({
      from: '2026-03-08',
      to: '2026-03-14',
    });
    expect(owned.state.bookings().map((item) => item.id)).toEqual(['current']);
    expect(owned.state.loading()).toBe(false);
    expect(owned.state.error()).toBeUndefined();
    owned.dispose();
  });

  it('ignores obsolete failures while a newer request remains in flight', async () => {
    const first = deferred<Booking[]>();
    const second = deferred<Booking[]>();
    const loadInsights = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const owned = createRoot((dispose) => ({
      dispose,
      state: createInsightsState({ loadInsights }, 'UTC'),
    }));
    const oldRequest = owned.state.load('2026-03-01', '2026-03-07');
    const currentRequest = owned.state.load('2026-03-08', '2026-03-14');
    first.reject(new Error('Old request failed'));
    await oldRequest;
    expect(owned.state.error()).toBeUndefined();
    expect(owned.state.loading()).toBe(true);
    second.resolve([booking('current')]);
    await currentRequest;
    expect(owned.state.bookings()[0].id).toBe('current');
    expect(owned.state.loading()).toBe(false);
    owned.dispose();
  });

  it('clears stale data on failure and retries the same current and comparison bounds', async () => {
    const retry = deferred<Booking[]>();
    const loadInsights = vi
      .fn()
      .mockResolvedValueOnce([booking('old')])
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockReturnValueOnce(retry.promise);
    const owned = createRoot((dispose) => ({
      dispose,
      state: createInsightsState({ loadInsights }, 'America/New_York'),
    }));
    await owned.state.load('2026-03-01', '2026-03-01');
    await owned.state.load('2026-03-08', '2026-03-08');
    expect(owned.state.bookings()).toEqual([]);
    expect(owned.state.error()).toBe('Network unavailable');
    expect(owned.state.loading()).toBe(false);
    const retryRequest = owned.state.load();
    expect(owned.state.error()).toBeUndefined();
    expect(owned.state.loading()).toBe(true);
    expect(loadInsights.mock.calls[1]).toEqual([
      '2026-03-07T05:00:00.000Z',
      '2026-03-09T04:00:00.000Z',
    ]);
    expect(loadInsights.mock.calls[2]).toEqual(loadInsights.mock.calls[1]);
    retry.resolve([booking('fresh')]);
    await retryRequest;
    expect(owned.state.bookings()[0].id).toBe('fresh');
    expect(owned.state.loading()).toBe(false);
    owned.dispose();
  });

  it('ignores a report resolving after the owner scope is unmounted', async () => {
    const pending = deferred<Booking[]>();
    const owned = createRoot((dispose) => ({
      dispose,
      state: createInsightsState(
        { loadInsights: () => pending.promise },
        'UTC'
      ),
    }));
    const request = owned.state.load('2026-03-08', '2026-03-08');
    owned.dispose();
    pending.resolve([booking('previous-owner')]);
    await request;
    expect(owned.state.bookings()).toEqual([]);
    expect(owned.state.error()).toBeUndefined();
  });
});
