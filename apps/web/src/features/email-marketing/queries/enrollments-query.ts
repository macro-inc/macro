import { useUserId } from '@core/context/user';
import { keepPreviousData, useQuery } from '@tanstack/solid-query';
import { unwrap } from 'solid-js/store';
import {
  attentionFor,
  collectIssues,
  inspectionTargets,
  senderStatusOf,
} from '../core/attention';
import type { AttentionReason, Enrollment } from '../core/model';
import { createContactQueries } from './contacts';
import { createDatabaseMarketingRepository } from './database-repository';
import { createGmailSequenceDelivery } from './gmail-delivery';
import { marketingKeys } from './keys';

/** Module-scope factory so the cached queryFn never retains a view's scope. */
export function marketingEnrollmentsQueryOptions(userId: string | undefined) {
  return {
    queryKey: marketingKeys.snapshot(userId).queryKey,
    queryFn: () => createDatabaseMarketingRepository().load(),
    enabled: !!userId,
  };
}

/** Shared enrollment snapshot for CRM, scoped to the signed-in account. */
export function useMarketingEnrollments() {
  const userId = useUserId();
  return useQuery(() => marketingEnrollmentsQueryOptions(userId()));
}

/** Delivery problems for these enrollments, by enrollment id. */
async function readAttention(userId: string, entries: Enrollment[]) {
  const senders = await createContactQueries(() => userId).loadSenders();
  const status = (senderId: string) => senderStatusOf(senders, senderId);
  const { found } = await collectIssues(
    createGmailSequenceDelivery().inspect,
    inspectionTargets(entries, status)
  );
  const result: Record<string, AttentionReason> = {};
  for (const entry of entries) {
    const reason = attentionFor(entry, status, found);
    if (reason) result[entry.id] = reason;
  }
  return result;
}

export function contactAttentionQueryOptions(
  userId: string | undefined,
  entries: Enrollment[]
) {
  return {
    queryKey: marketingKeys.attention(
      userId,
      entries.map((entry) => `${entry.id}:${entry.updatedAt}`)
    ).queryKey,
    queryFn: () => readAttention(userId!, entries),
    enabled: !!userId && entries.some((entry) => entry.status !== 'stopped'),
    staleTime: 60_000,
    // Keep the last answer while a changed enrollment refetches it.
    placeholderData: keepPreviousData,
  };
}

/** Failed, missing, or disconnected sends for one contact's enrollments. */
export function useContactAttention(entries: () => Enrollment[]) {
  const userId = useUserId();
  // Plain copies: the cached queryFn must not hold the snapshot query's store.
  return useQuery(() =>
    contactAttentionQueryOptions(
      userId(),
      entries().map((entry) => structuredClone(unwrap(entry)))
    )
  );
}
