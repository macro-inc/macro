import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';
import type { EmailFollowupCommand } from '@service-storage/generated/schemas/emailFollowupCommand';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { fetchGraphqlEmailThread } from '../email/graphql/thread';
import { emailKeys } from '../email/keys';
import { refetchSoupEntity } from '../soup/cache';
import { refreshActiveGraphqlSoupQueries } from '../soup/graphql/active-queries';
import { reminderKeys } from './keys';

export function useEmailFollowupQuery(threadId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: reminderKeys.email(threadId()).queryKey,
    queryFn: () =>
      throwOnErr(() =>
        storageServiceClient.reminders.getEmailFollowup(threadId())
      ),
    refetchInterval: 30_000,
  }));
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
  try {
    await afterPersisted?.(result);
  } catch (error) {
    console.error('Email reminder saved but navigation failed', error);
  }
  try {
    await Promise.all([
      refetchSoupEntity(threadId, 'emailThread'),
      refetchSoupEntity(result.reminderId, 'reminder'),
      queryClient.invalidateQueries({
        queryKey: emailKeys.threadMessages(threadId).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: emailKeys.previews._def }),
      ...(isFeatureEnabled(enableGraphqlSoup)
        ? [refreshActiveGraphqlSoupQueries(), fetchGraphqlEmailThread(threadId)]
        : []),
      queryClient.invalidateQueries({ queryKey: reminderKeys.list._def }),
      queryClient.invalidateQueries({
        queryKey: reminderKeys.detail(result.reminderId).queryKey,
      }),
    ]);
  } catch (error) {
    console.error('Email reminder saved but refresh failed', error);
  }
  return result;
}
