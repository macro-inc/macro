import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { EmailReminderPage } from '@service-storage/generated/schemas/emailReminderPage';
import type { ListEmailRemindersParams } from '@service-storage/generated/schemas/listEmailRemindersParams';
import { useInfiniteQuery, useQueries } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { reminderKeys } from './keys';

export function emailSummaryQueryOptions(
  userId: string | undefined,
  threadIds: string[]
) {
  return {
    queryKey: reminderKeys.emailSummaries(userId, threadIds).queryKey,
    enabled: !!userId && threadIds.length > 0,
    queryFn: () =>
      throwOnErr(() =>
        storageServiceClient.reminders.emailReminderSummaries(threadIds)
      ),
    staleTime: 15_000,
    refetchInterval: 30_000,
    throwOnError: false,
  };
}

/** Only mounted rows are registered; batches share TanStack's caller-scoped cache. */
export function useEmailReminderSummaries(
  options: Accessor<{
    userId: string | undefined;
    threadIds: string[];
    enabled: boolean;
  }>
) {
  return useQueries(() => {
    const { userId, threadIds, enabled } = options();
    const ids = [...new Set(threadIds)].sort();
    const batches = [];
    for (let index = 0; index < ids.length; index += 100) {
      batches.push({
        ...emailSummaryQueryOptions(userId, ids.slice(index, index + 100)),
        enabled: !!userId && enabled,
      });
    }
    return { queries: batches };
  });
}

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

/** All owning mutation paths share these two read surfaces. */
export async function invalidateEmailReminderReads() {
  await Promise.all([
    invalidateEmailReminderCollection(),
    queryClient.invalidateQueries({
      queryKey: reminderKeys.emailSummaries._def,
    }),
  ]);
}
