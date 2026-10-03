import type { UnifiedNotification } from './types';

/** Index exact message/comment matches once, without tracking read history metadata. */
export function indexUnreadMessageNotifications(
  notifications: readonly UnifiedNotification[]
): ReadonlyMap<string, UnifiedNotification[]> {
  const byMessage = new Map<string, UnifiedNotification[]>();
  const append = (id: string, notification: UnifiedNotification) => {
    const matches = byMessage.get(id);
    if (matches) matches.push(notification);
    else byMessage.set(id, [notification]);
  };

  for (const notification of notifications) {
    if (notification.state !== 'unseen') continue;
    const content = notification.notification_metadata.content;
    const messageId = 'messageId' in content ? content.messageId : undefined;
    const commentId =
      'commentId' in content ? String(content.commentId) : undefined;
    if (messageId !== undefined) append(messageId, notification);
    if (commentId !== undefined && commentId !== messageId)
      append(commentId, notification);
  }

  return byMessage;
}
