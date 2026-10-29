import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../client';
import { calendarKeys } from '../keys';
import {
  clearTeamCalendarQueries,
  ensureTeamCalendarExpiry,
  refreshTeamCalendarQueries,
  resetTeamCalendarSession,
  subscribeToTeamCalendarReset,
  TEAM_CALENDAR_MAX_DATA_AGE_MS,
} from '../team-cache';
import { calendarTeamKeys } from '../team-keys';

vi.mock('../../client', () => ({
  queryClient: new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
}));

describe('team authorization invalidation', () => {
  afterEach(() => {
    queryClient.clear();
    vi.useRealTimers();
  });

  it('removes teammate data before a failing refetch settles', async () => {
    const queryKey = calendarKeys.teamOutOfOffice(
      'alice',
      undefined,
      'team'
    ).queryKey;
    queryClient.setQueryData(queryKey, { items: [{ title: 'Private' }] });
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: async () => {
        throw new Error('revoked');
      },
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    const refresh = refreshTeamCalendarQueries();
    expect(observer.getCurrentResult().data).toBeUndefined();
    await refresh;
    expect(observer.getCurrentResult().isError).toBe(true);
    expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe();
  });

  it('keeps OOO rows and their selection during an unrelated calendar refresh', async () => {
    const queryKey = calendarKeys.teamOutOfOffice(
      'alice',
      undefined,
      'team'
    ).queryKey;
    const cached = [{ title: 'Vacation' }];
    queryClient.setQueryData(queryKey, cached);
    let finish!: (rows: typeof cached) => void;
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: () =>
        new Promise<typeof cached>((resolve) => {
          finish = resolve;
        }),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    const closeSelection = vi.fn();
    const unsubscribeReset = subscribeToTeamCalendarReset(closeSelection);
    const refresh = refreshTeamCalendarQueries({ outOfOfficeChanged: false });
    expect(observer.getCurrentResult().data).toEqual(cached);
    expect(observer.getCurrentResult().isPending).toBe(false);
    expect(observer.getCurrentResult().isFetching).toBe(true);
    expect(closeSelection).not.toHaveBeenCalled();
    finish([{ title: 'Updated vacation' }]);
    await refresh;
    expect(observer.getCurrentResult().data).toEqual([
      { title: 'Updated vacation' },
    ]);
    expect(closeSelection).not.toHaveBeenCalled();
    unsubscribeReset();
    unsubscribe();
  });

  it("keeps the viewer's own team and settings visible while they refetch", async () => {
    const identity = { userId: 'alice', teamId: 'team' };
    const keys = [
      calendarTeamKeys.identity('alice').queryKey,
      calendarTeamKeys.sharing(identity).queryKey,
      calendarTeamKeys.availabilityCalendars(identity).queryKey,
    ];
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const observers = keys.map((queryKey) => {
      queryClient.setQueryData(queryKey, 'cached');
      const observer = new QueryObserver(queryClient, {
        queryKey,
        queryFn: async () => {
          await pending;
          return 'fresh';
        },
        staleTime: Infinity,
      });
      return { observer, unsubscribe: observer.subscribe(() => {}) };
    });
    const refresh = refreshTeamCalendarQueries();
    for (const { observer } of observers) {
      expect(observer.getCurrentResult().data).toBe('cached');
      expect(observer.getCurrentResult().isFetching).toBe(true);
    }
    finish();
    await refresh;
    for (const { observer, unsubscribe } of observers) {
      expect(observer.getCurrentResult().data).toBe('fresh');
      unsubscribe();
    }
  });

  it('purges all team scopes on logout while preserving own occurrences', () => {
    const first = calendarTeamKeys.sharing({
      userId: 'alice',
      teamId: 'one',
    }).queryKey;
    const second = calendarTeamKeys.sharing({
      userId: 'bob',
      teamId: 'two',
    }).queryKey;
    const own = calendarKeys.occurrences('alice', undefined).queryKey;
    queryClient.setQueryData(first, 'all');
    queryClient.setQueryData(second, 'none');
    queryClient.setQueryData(own, 'own');
    clearTeamCalendarQueries();
    expect(queryClient.getQueryData(first)).toBeUndefined();
    expect(queryClient.getQueryData(second)).toBeUndefined();
    expect(queryClient.getQueryData(own)).toBe('own');
  });

  it('resets mounted observers and detached selections synchronously without starting requests', () => {
    const queryKey = calendarTeamKeys.sharing({
      userId: 'alice',
      teamId: 'team',
    }).queryKey;
    queryClient.setQueryData(queryKey, { sharing: 'all' });
    const queryFn = vi.fn(async () => ({ sharing: 'none' }));
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    const closeSelection = vi.fn();
    const unsubscribeReset = subscribeToTeamCalendarReset(closeSelection);
    resetTeamCalendarSession();
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(closeSelection).toHaveBeenCalledOnce();
    expect(queryFn).not.toHaveBeenCalled();
    unsubscribeReset();
    unsubscribe();
  });

  it('expires a successful payload while a refetch hangs and rejects its late response', async () => {
    vi.useFakeTimers();
    ensureTeamCalendarExpiry();
    const queryKey = calendarTeamKeys.sharing({
      userId: 'alice',
      teamId: 'team',
    }).queryKey;
    const own = calendarKeys.occurrences('alice', undefined).queryKey;
    queryClient.setQueryData(queryKey, { sharing: 'all' });
    queryClient.setQueryData(own, 'own');
    let resolveRequest!: (data: { sharing: string }) => void;
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: () =>
        new Promise<{ sharing: string }>((resolve) => {
          resolveRequest = resolve;
        }),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    const closeSelection = vi.fn();
    const unsubscribeReset = subscribeToTeamCalendarReset(closeSelection);
    await vi.advanceTimersByTimeAsync(30_000);
    const refetch = observer.refetch();
    expect(observer.getCurrentResult().isFetching).toBe(true);
    await vi.advanceTimersByTimeAsync(TEAM_CALENDAR_MAX_DATA_AGE_MS - 30_001);
    expect(observer.getCurrentResult().data).toEqual({ sharing: 'all' });
    await vi.advanceTimersByTimeAsync(1);
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(closeSelection).toHaveBeenCalledOnce();
    resolveRequest({ sharing: 'all' });
    await refetch;
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(queryClient.getQueryData(own)).toBe('own');
    unsubscribeReset();
    unsubscribe();
  });

  it('bounds an initial request and grants a new lease only for a successful response', async () => {
    vi.useFakeTimers();
    ensureTeamCalendarExpiry();
    const queryKey = calendarTeamKeys.identity('alice').queryKey;
    let resolveRequest!: (data: string) => void;
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: () =>
        new Promise<string>((resolve) => {
          resolveRequest = resolve;
        }),
    });
    const unsubscribe = observer.subscribe(() => {});
    expect(observer.getCurrentResult().isFetching).toBe(true);
    await vi.advanceTimersByTimeAsync(TEAM_CALENDAR_MAX_DATA_AGE_MS);
    expect(observer.getCurrentResult().fetchStatus).toBe('idle');
    resolveRequest('expired');
    await Promise.resolve();
    expect(observer.getCurrentResult().data).toBeUndefined();

    const refetch = observer.refetch();
    resolveRequest('fresh');
    await refetch;
    await vi.advanceTimersByTimeAsync(TEAM_CALENDAR_MAX_DATA_AGE_MS - 1);
    expect(observer.getCurrentResult().data).toBe('fresh');
    await vi.advanceTimersByTimeAsync(1);
    expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe();
  });

  it('clears detached selections on authorization reset, not ordinary cache writes', async () => {
    const onReset = vi.fn();
    const unsubscribe = subscribeToTeamCalendarReset(onReset);
    const team = calendarKeys.teamOutOfOffice(
      'alice',
      undefined,
      'team'
    ).queryKey;
    const own = calendarKeys.occurrences('alice', undefined).queryKey;
    queryClient.setQueryData(team, { items: [] });
    queryClient.setQueryData(own, []);
    expect(onReset).not.toHaveBeenCalled();
    await queryClient.resetQueries({ queryKey: own });
    expect(onReset).not.toHaveBeenCalled();
    await refreshTeamCalendarQueries();
    expect(onReset).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
