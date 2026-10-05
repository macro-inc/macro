import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { EmailReminderPage } from '@service-storage/generated/schemas/emailReminderPage';
import type { ListEmailRemindersParams } from '@service-storage/generated/schemas/listEmailRemindersParams';
import { useInfiniteQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { reminderKeys } from './keys';

export function useEmailReminderCollection(
  options: Accessor<{
    userId: string | undefined;
    enabled: boolean;
    filters: ListEmailRemindersParams;
  }>
) {
  return useInfiniteQuery(() => {
    const { userId, enabled, filters } = options();
    return {
      queryKey: reminderKeys.emailCollection(userId, filters).queryKey,
      enabled: !!userId && enabled,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
        throwOnErr(() =>
          storageServiceClient.reminders.listEmailReminders({
            ...filters,
            cursor: pageParam,
            limit: 100,
          })
        ),
      getNextPageParam: (page: EmailReminderPage) =>
        page.nextCursor ?? undefined,
      refetchInterval: 30_000,
      throwOnError: false,
    };
  });
}

/** Refill facet-filtered pages after email mutations commit. */
export function invalidateEmailReminderCollection() {
  return queryClient.invalidateQueries({
    queryKey: reminderKeys.emailCollection._def,
  });
}

/** Reminder mutations refresh collection membership and its row clocks together. */
export const invalidateEmailReminderReads = invalidateEmailReminderCollection;
