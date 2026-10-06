import type { Reminder } from '@service-storage/generated/schemas/reminder';
import type { ReminderCollectionPage } from '@service-storage/generated/schemas/reminderCollectionPage';
import type { InfiniteData } from '@tanstack/solid-query';
import { afterEach, expect, it } from 'vitest';
import { queryClient } from '../client';
import { updateReminderCollection } from './collection';
import { reminderKeys } from './keys';

afterEach(() =>
  queryClient.removeQueries({ queryKey: reminderKeys.collection._def })
);
it.each([false, true])(
  'keeps the unfiltered row and removes completion mismatches (done: %s)',
  (completed) => {
    const reminder = {
      id: 'reminder',
      completedAt: completed ? '2026-10-01T12:00:00Z' : undefined,
    } as Reminder;
    const all = reminderKeys.collection('owner').queryKey;
    const filtered = reminderKeys.collection('owner', !completed).queryKey;
    const data: InfiniteData<ReminderCollectionPage> = {
      pages: [
        {
          items: [
            {
              reminder: {
                ...reminder,
                completedAt: completed ? undefined : '2026-10-01T11:00:00Z',
              },
              reference: null,
              emailFollowup: null,
            },
          ],
          nextCursor: null,
        },
      ],
      pageParams: [undefined],
    };
    queryClient.setQueryData(all, data);
    queryClient.setQueryData(filtered, data);
    updateReminderCollection(reminder);
    expect(
      queryClient.getQueryData<InfiniteData<ReminderCollectionPage>>(all)
        ?.pages[0].items[0].reminder
    ).toEqual(reminder);
    expect(
      queryClient.getQueryData<InfiniteData<ReminderCollectionPage>>(filtered)
        ?.pages[0].items
    ).toEqual([]);
  }
);
