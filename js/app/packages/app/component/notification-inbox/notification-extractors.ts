import type { UnifiedNotification } from '@notifications';

export const notificationContent = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply':
      return metadata.content.messageContent;
    case 'mentioned_in_document_comment':
    case 'replied_to_document_comment_thread':
    case 'commented_on_document':
      return metadata.content.text;
    case 'new_email':
      return metadata.content.snippet ?? metadata.content.subject;
    case 'ai_response':
      return metadata.content.summary;
    case 'github_pr_comment':
      return metadata.content.commentSnippet;
    case 'github_pr_mention':
      return metadata.content.textSnippet;
    case 'github_pr_review':
      return metadata.content.reviewSnippet ?? undefined;
    default:
      return undefined;
  }
};

export const notificationTitle = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'new_email':
      return metadata.content.subject;
    case 'task_assigned':
      return metadata.content.taskName ?? undefined;
    case 'document_mention':
    case 'mentioned_in_document_comment':
    case 'replied_to_document_comment_thread':
    case 'commented_on_document':
      return metadata.content.documentName;
    case 'channel_invite':
      return metadata.content.channelName;
    case 'invite_to_team':
      return metadata.content.teamName;
    case 'github_pr_status_changed':
    case 'github_review_requested':
    case 'github_pr_comment':
    case 'github_pr_mention':
    case 'github_pr_review':
      return metadata.content.title || metadata.content.displayName;
    case 'ai_response':
      return 'AI response';
    default:
      return undefined;
  }
};

export const notificationAction = (
  notification: UnifiedNotification
): string | undefined => {
  switch (notification.notification_metadata.tag) {
    case 'channel_mention':
      return 'mentioned you';
    case 'channel_message_send':
      return 'sent a message';
    case 'channel_message_reply':
      return 'replied';
    case 'channel_invite':
      return 'started a DM';
    case 'invite_to_team':
      return 'invited you';
    case 'document_mention':
      return 'mentioned you';
    case 'mentioned_in_document_comment':
      return 'mentioned you';
    case 'replied_to_document_comment_thread':
      return 'replied';
    case 'commented_on_document':
      return 'commented';
    case 'task_assigned':
      return 'assigned you';
    case 'github_pr_status_changed':
      return notification.notification_metadata.content.status;
    case 'github_review_requested':
      return 'requested your review';
    case 'github_pr_comment':
      return 'commented';
    case 'github_pr_mention':
      return 'mentioned you';
    case 'github_pr_review':
      return 'reviewed';
    default:
      return undefined;
  }
};

export const notificationSenderName = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_message_send':
      return metadata.content.sender ?? notification.sender_id ?? undefined;
    case 'github_pr_status_changed':
    case 'github_review_requested':
    case 'github_pr_comment':
    case 'github_pr_mention':
    case 'github_pr_review':
      return (
        metadata.content.senderGithubLogin ??
        notification.sender_id ??
        undefined
      );
    default:
      return notification.sender_id ?? undefined;
  }
};
