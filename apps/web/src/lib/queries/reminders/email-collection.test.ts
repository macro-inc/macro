import { QueryObserver } from '@tanstack/solid-query';
import { afterEach, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import {
  emailSummaryQueryOptions,
  invalidateEmailReminderReads,
} from './email-collection';
import { reminderKeys } from './keys';
import { invalidateRemindersById } from './reminders';

afterEach(() => {
  queryClient.removeQueries({ queryKey: reminderKeys.emailCollection._def });
  queryClient.removeQueries({ queryKey: reminderKeys.emailSummaries._def });
});

it('shares a batch fetch between active readers and isolates a changed account', async () => {
  const fetch = vi.fn(async () => []);
  const options = {
    ...emailSummaryQueryOptions('alice', ['a', 'b']),
    queryFn: fetch,
    staleTime: Infinity,
  };
  const first = new QueryObserver(queryClient, options);
  const second = new QueryObserver(queryClient, options);
  const stop1 = first.subscribe(() => {});
  const stop2 = second.subscribe(() => {});
  try {
    await vi.waitFor(() =>
      expect(first.getCurrentResult().isSuccess).toBe(true)
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    second.setOptions({
      ...emailSummaryQueryOptions('bob', ['a', 'b']),
      queryFn: fetch,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(second.getCurrentResult().data).toEqual([]));
  } finally {
    stop1();
    stop2();
  }
});

it.each(['followup', 'completion'] as const)(
  'refetches both active read surfaces after %s changes',
  async (mutation) => {
    const readers = [
      reminderKeys.emailCollection('owner', {}).queryKey,
      reminderKeys.emailSummaries('owner', ['a']).queryKey,
    ].map((queryKey) => {
      const queryFn = vi.fn(async () => []);
      queryClient.setQueryData(queryKey, []);
      const observer = new QueryObserver(queryClient, {
        queryKey,
        queryFn,
        staleTime: Infinity,
      });
      return { queryFn, stop: observer.subscribe(() => {}) };
    });
    try {
      if (mutation === 'followup') await invalidateEmailReminderReads();
      else invalidateRemindersById(['completed-reminder']);
      await vi.waitFor(() =>
        readers.forEach(({ queryFn }) =>
          expect(queryFn).toHaveBeenCalledTimes(1)
        )
      );
    } finally {
      readers.forEach(({ stop }) => stop());
    }
  }
);
