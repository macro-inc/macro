import { QueryObserver } from '@tanstack/solid-query';
import { afterEach, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import { invalidateEmailReminderReads } from './email-collection';
import { reminderKeys } from './keys';

afterEach(() => {
  queryClient.removeQueries({ queryKey: reminderKeys.emailCollection._def });
});

it('refetches the collection and its clock metadata after followup changes', async () => {
  const readers = [reminderKeys.emailCollection('owner', {}).queryKey].map(
    (queryKey) => {
      const queryFn = vi.fn(async () => []);
      queryClient.setQueryData(queryKey, []);
      const observer = new QueryObserver(queryClient, {
        queryKey,
        queryFn,
        staleTime: Infinity,
      });
      return { queryFn, stop: observer.subscribe(() => {}) };
    }
  );
  try {
    await invalidateEmailReminderReads();
    await vi.waitFor(() =>
      readers.forEach(({ queryFn }) => expect(queryFn).toHaveBeenCalledTimes(1))
    );
  } finally {
    readers.forEach(({ stop }) => stop());
  }
});
