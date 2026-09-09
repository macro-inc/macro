import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { storageServiceClient } from '@service-storage/client';

/**
 * Check popup eligibility against the same inbox/importance/shared predicates
 * used by the email service's Signal tier. Deliberately fetch fresh: cached
 * labels or a previously loaded Signal page can predate a sender-policy change.
 * The REST endpoint is shared by both notification transports; this lookup must
 * not insert a filtered one-thread page into the user's in-app notification feed.
 */
export async function checkEmailNotificationSignal(threadId: string) {
  const result = await storageServiceClient.getSoupItems({
    params: {},
    body: {
      ...QUERY_FILTERS_BASE,
      limit: 1,
      emailView: 'inbox',
      email_filters: {
        email_thread_ids: [threadId],
        importance: true,
        shared: 'exclude',
      },
    },
  });

  return result.map(({ items }) =>
    items.some(
      (item) => item.tag === 'emailThread' && item.data.id === threadId
    )
  );
}
