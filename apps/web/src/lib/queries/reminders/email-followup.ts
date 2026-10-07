import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';
import type { EmailFollowupCommand } from '@service-storage/generated/schemas/emailFollowupCommand';
import type { EmailReminderPage } from '@service-storage/generated/schemas/emailReminderPage';
import {
  type InfiniteData,
  queryOptions,
  useQuery,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { refreshEmailFollowup } from './email-refresh';
import { reminderKeys } from './keys';

/** Reuse a loaded Reminders page without treating filtered-out emails as absent. */
export function emailFollowupQueryOptions(threadId: string) {
  const cached = queryClient
    .getQueriesData<InfiniteData<EmailReminderPage>>({
      queryKey: reminderKeys.emailCollection._def,
    })
    .flatMap(([key, data]) => {
      const state = queryClient.getQueryState(key);
      const followup = data?.pages
        .flatMap((page) => page.items)
        .find((item) => item.threadId === threadId)?.followup;
      return followup && state && !state.isInvalidated
        ? [{ followup, updatedAt: state.dataUpdatedAt }]
        : [];
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const queryKey = reminderKeys.email(threadId).queryKey;
  const detailUpdatedAt =
    queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
  if (cached && cached.updatedAt > detailUpdatedAt) {
    queryClient.setQueryData(queryKey, cached.followup, {
      updatedAt: cached.updatedAt,
    });
  }
  return queryOptions({
    queryKey,
    queryFn: () =>
      throwOnErr(() =>
        storageServiceClient.reminders.getEmailFollowup(threadId)
      ),
    initialData: cached?.followup,
    initialDataUpdatedAt: cached?.updatedAt,
    staleTime: 30_000,
    refetchInterval: 30_000,
    throwOnError: false,
  });
}

export function useEmailFollowupQuery(threadId: Accessor<string>) {
  return useQuery(() => emailFollowupQueryOptions(threadId()));
}

/** One server command owns scheduling and inbox movement. No client archive. */
export async function executeEmailFollowup(
  threadId: string,
  command: EmailFollowupCommand,
  afterPersisted?: (result: EmailFollowup) => void | Promise<void>
) {
  const result = await throwOnErr(() =>
    storageServiceClient.reminders.setEmailFollowup(threadId, command)
  );
  // Presentation/cache failures must not make the successful write retryable.
  queryClient.setQueryData(reminderKeys.email(threadId).queryKey, result);
  void reconcileEmailFollowup(threadId, result, afterPersisted);
  return result;
}

/** Navigation runs before list refreshes, but neither holds the dialog open. */
async function reconcileEmailFollowup(
  threadId: string,
  result: EmailFollowup,
  afterPersisted?: (result: EmailFollowup) => void | Promise<void>
) {
  try {
    await afterPersisted?.(result);
  } catch (error) {
    console.error('Email reminder saved but navigation failed', error);
  }
  try {
    await refreshEmailFollowup(threadId);
  } catch (error) {
    console.error('Email reminder saved but refresh failed', error);
  }
}
