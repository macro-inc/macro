import type { ListView } from '@app/constants/list-views';
import type { NotificationType } from '@core/types';
import type { UnifiedNotification } from '@notifications';

export function notificationToSidebarId(
  n: UnifiedNotification
): ListView | null {
  const tag = n.notification_metadata.tag as NotificationType;
  switch (tag) {
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply':
    case 'channel_invite':
    case 'call-started':
    case 'document_mention':
      return 'channels';
    case 'new_email':
      return 'mail';
    case 'task_assigned':
      return 'tasks';
    case 'mentioned_in_document_comment':
    case 'replied_to_document_comment_thread':
    case 'commented_on_document':
      return 'documents';
    case 'ai_response':
      return 'agents';
    case 'invite_to_team':
      return null;
    default:
      return null;
  }
}
