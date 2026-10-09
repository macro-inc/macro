import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { queryClient } from '../client';
import { fetchGraphqlEmailThread } from '../email/graphql/thread';
import { emailKeys } from '../email/keys';
import { refetchSoupEntity } from '../soup/cache';
import { refreshActiveGraphqlSoupQueries } from '../soup/graphql/active-queries';
import { invalidateEmailReminderReads } from './email-collection';
import { reminderKeys } from './keys';

/** Scheduling and delivery both change reminder membership and inbox position. */
export async function refreshEmailFollowup(threadId: string) {
  await Promise.all([
    invalidateEmailReminderReads(),
    queryClient.invalidateQueries({
      queryKey: reminderKeys.email(threadId).queryKey,
    }),
    refetchSoupEntity(threadId, 'emailThread'),
    queryClient.invalidateQueries({
      queryKey: emailKeys.threadMessages(threadId).queryKey,
    }),
    queryClient.invalidateQueries({ queryKey: emailKeys.previews._def }),
    ...(isFeatureEnabled(enableGraphqlSoup)
      ? [refreshActiveGraphqlSoupQueries(), fetchGraphqlEmailThread(threadId)]
      : []),
  ]);
}
