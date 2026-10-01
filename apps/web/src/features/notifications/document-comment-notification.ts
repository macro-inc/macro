import { compareDateDesc } from '@core/util/date';
import type { WithNotification } from '@entity/types/notification';
import type { UnifiedNotification } from './types';

export const DOCUMENT_COMMENT_EVENT_TYPES = [
  'mentioned_in_document_comment',
  'replied_to_document_comment_thread',
  'commented_on_document',
] as const;

const isDocumentCommentTag = (tag: string) =>
  (DOCUMENT_COMMENT_EVENT_TYPES as readonly string[]).includes(tag);

/**
 * A document row can announce its newest outstanding event when it is a
 * comment. Home supplies a cutoff so newer own activity cannot borrow an old
 * comment's label or click target. Reading a comment does not dismiss it.
 */
export function getDocumentCommentNotification(
  entity: WithNotification<{
    type: string;
  }>
): UnifiedNotification | undefined {
  if (entity.type !== 'document') return undefined;
  const notification = (entity.notifications?.() ?? [])
    .filter((n) => n.state !== 'done')
    .sort((a, b) => compareDateDesc(a.created_at, b.created_at))[0];
  if (
    !notification ||
    !isDocumentCommentTag(notification.notification_metadata.tag)
  ) {
    return undefined;
  }
  if (
    entity.notificationDisplayCutoff != null &&
    compareDateDesc(notification.created_at, entity.notificationDisplayCutoff) >
      0
  ) {
    return undefined;
  }
  return notification;
}
