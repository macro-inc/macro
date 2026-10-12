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
 * A document row's newest outstanding event. Home supplies a cutoff so newer
 * own activity cannot borrow an older event's label or click target.
 */
export function getNewestDocumentNotification(
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
    (entity.notificationDisplayCutoff != null &&
      compareDateDesc(
        notification.created_at,
        entity.notificationDisplayCutoff
      ) > 0)
  ) {
    return undefined;
  }
  return notification;
}

/**
 * A document row can announce its newest outstanding event when it is a
 * comment. Reading a comment does not dismiss it.
 */
export function getDocumentCommentNotification(
  entity: WithNotification<{
    type: string;
  }>
): UnifiedNotification | undefined {
  const notification = getNewestDocumentNotification(entity);
  return notification &&
    isDocumentCommentTag(notification.notification_metadata.tag)
    ? notification
    : undefined;
}
