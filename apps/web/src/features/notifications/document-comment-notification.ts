import { compareDateDesc } from '@core/util/date';
import type { UnifiedNotification } from './types';

export const DOCUMENT_COMMENT_EVENT_TYPES = [
  'mentioned_in_document_comment',
  'replied_to_document_comment_thread',
  'commented_on_document',
] as const;

const isDocumentCommentTag = (tag: string) =>
  (DOCUMENT_COMMENT_EVENT_TYPES as readonly string[]).includes(tag);

/** The newest unread comment notification a document row announces. */
export function getDocumentCommentNotification(entity: {
  type: string;
  notifications?: () => UnifiedNotification[];
}): UnifiedNotification | undefined {
  if (entity.type !== 'document') return undefined;
  return (entity.notifications?.() ?? [])
    .filter(
      (n) =>
        n.state === 'unseen' &&
        isDocumentCommentTag(n.notification_metadata.tag)
    )
    .sort((a, b) => compareDateDesc(a.created_at, b.created_at))[0];
}
