import { useUserId } from '@core/context/user';
import { keepPreviousData, useQuery } from '@tanstack/solid-query';
import { unwrap } from 'solid-js/store';
import {
  attentionFor,
  collectIssues,
  inspectionTargets,
  isFinished,
  senderStatusOf,
  sentSteps,
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

/** What the scheduler says about a contact's enrollments, by enrollment id. */
export type ContactDelivery = {
  /** Problems the stored status does not show. */
  reasons: Record<string, AttentionReason>;
  /** Steps already sent. */
  sent: Record<string, number>;
  /** Enrollments with nothing left to send. */
  finished: string[];
};

async function readAttention(
  userId: string,
  entries: Enrollment[]
): Promise<ContactDelivery> {
  const senders = await createContactQueries(() => userId).loadSenders();
  const status = (senderId: string) => senderStatusOf(senders, senderId);
  const { found, sent } = await collectIssues(
    createGmailSequenceDelivery().inspect,
    inspectionTargets(entries, status)
  );
  const result: ContactDelivery = { reasons: {}, sent: {}, finished: [] };
  for (const entry of entries) {
    const reason = attentionFor(entry, status, found);
    if (reason) result.reasons[entry.id] = reason;
    result.sent[entry.id] = sentSteps(entry, sent);
    if (isFinished(entry, sent)) result.finished.push(entry.id);
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

/** Delivery problems and progress for one contact's enrollments. */
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
