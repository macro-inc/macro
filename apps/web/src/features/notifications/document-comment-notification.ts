import { compareDateDesc } from '@core/util/date';
import type { UnifiedNotification } from './types';

export const DOCUMENT_COMMENT_EVENT_TYPES = [
  'mentioned_in_document_comment',
  'replied_to_document_comment_thread',
  'commented_on_document',
] as const;

const isDocumentCommentTag = (tag: string) =>
  (DOCUMENT_COMMENT_EVENT_TYPES as readonly string[]).includes(tag);

/**
 * The comment notification a document row stands for: its newest one that is
 * not done. Like a channel thread row, the row keeps pointing at that comment
 * after it is read; marking it done is what returns the row to the document.
 */
export function getDocumentCommentNotification(entity: {
  type: string;
  notifications?: () => UnifiedNotification[];
}): UnifiedNotification | undefined {
  if (entity.type !== 'document') return undefined;
  return (entity.notifications?.() ?? [])
    .filter(
      (n) =>
        n.state !== 'done' && isDocumentCommentTag(n.notification_metadata.tag)
    )
    .sort((a, b) => compareDateDesc(a.created_at, b.created_at))[0];
}
