import type { MailItemFieldsFragment } from '@service-storage/graphql/generated/graphql';
import type { GraphqlSoupItem } from '@service-storage/graphql-soup';

export type CachedMailView = 'ALL' | 'INBOX' | 'DRAFTS' | 'SENT';
export const isCachedMailView = (value: unknown): value is CachedMailView =>
  value === 'ALL' ||
  value === 'INBOX' ||
  value === 'DRAFTS' ||
  value === 'SENT';

/** Canonical message snapshots are shared by ID, not overwritten by whichever
 * query-dependent thread preview a tab last returned. Never guess a draft from
 * the latest ALL message, or materialize an unhydrated preview as an empty row. */
export function materializeMailView(
  record: MailItemFieldsFragment,
  view: CachedMailView,
  timestamp: string
): GraphqlSoupItem | undefined {
  if (record.__typename !== 'GraphqlSoupEmailThread') return undefined;
  const preview =
    view === 'DRAFTS'
      ? record.mailDraftPreview
      : view === 'SENT'
        ? record.mailSentPreview
        : record.mailAllPreview;
  if (!preview) return undefined;
  return {
    ...record,
    sortTs: timestamp,
    createdAt: timestamp,
    emailName: preview.subject,
    snippet: preview.snippet,
    isDraft: preview.isDraft,
    senderEmail: preview.senderEmail,
    senderName: preview.senderName,
    senderPhotoUrl: preview.senderPhotoUrl,
  };
}
