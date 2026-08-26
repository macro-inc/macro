/**
 * Event types the notification service lets a user disable.
 * Keep this list aligned with `BLOCKABLE_NOTIFICATIONS` in
 * `services/notification_service/src/api/user_notification.rs`.
 * `email-digest-notification` is a delivery control, not an inbox event.
 */

export const EMAIL_DIGEST_NOTIFICATION_TYPE =
  'email-digest-notification' as const;

export type NotificationEventGroupId =
  | 'channels'
  | 'documents'
  | 'tasks'
  | 'calendar'
  | 'email'
  | 'ai'
  | 'github';

export type NotificationEventDefinition = {
  type: string;
  label: string;
  description: string;
};

export type NotificationEventGroup = {
  id: NotificationEventGroupId;
  label: string;
  events: readonly NotificationEventDefinition[];
};

export const NOTIFICATION_EVENT_GROUPS: readonly NotificationEventGroup[] = [
  {
    id: 'channels',
    label: 'Channels',
    events: [
      {
        type: 'channel_message_send',
        label: 'New messages',
        description: 'Messages in channels you belong to',
      },
      {
        type: 'channel_mention',
        label: 'Mentions',
        description: 'When someone mentions you in a channel',
      },
      {
        type: 'channel_message_reply',
        label: 'Thread replies',
        description: 'Replies in threads you are part of',
      },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    events: [
      {
        type: 'document_mention',
        label: 'Document mentions',
        description: 'When a document is mentioned in a channel',
      },
      {
        type: 'mentioned_in_document_comment',
        label: 'Comment mentions',
        description: 'When you are mentioned in a document comment',
      },
      {
        type: 'replied_to_document_comment_thread',
        label: 'Comment replies',
        description: 'Replies on comment threads you are part of',
      },
      {
        type: 'commented_on_document',
        label: 'New comments',
        description: 'Comments on documents you own',
      },
    ],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    events: [
      {
        type: 'task_assigned',
        label: 'Assignments',
        description: 'When a task is assigned to you',
      },
    ],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    events: [
      {
        type: 'calendar_event_reminder',
        label: 'Event reminders',
        description: 'When a calendar event is about to start',
      },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    events: [
      {
        type: 'new_email',
        label: 'New email',
        description: 'When a new email arrives',
      },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    events: [
      {
        type: 'ai_response',
        label: 'AI replies',
        description: 'When an AI chat responds',
      },
    ],
  },
  {
    id: 'github',
    label: 'GitHub',
    events: [
      {
        type: 'github_pr_status_changed',
        label: 'PR status',
        description: 'When a pull request changes lifecycle state',
      },
      {
        type: 'github_review_requested',
        label: 'Review requested',
        description: 'When your review is requested',
      },
      {
        type: 'github_pr_comment',
        label: 'PR comments',
        description: 'When someone comments on a pull request',
      },
      {
        type: 'github_pr_mention',
        label: 'PR mentions',
        description: 'When you are mentioned on a pull request',
      },
      {
        type: 'github_pr_review',
        label: 'PR reviews',
        description: 'When a review is submitted on your pull request',
      },
    ],
  },
];

export const BLOCKABLE_NOTIFICATION_EVENT_TYPES: readonly string[] =
  NOTIFICATION_EVENT_GROUPS.flatMap((group) =>
    group.events.map((event) => event.type)
  );

export const MUTED_ENTITY_TYPE_LABELS: Record<string, string> = {
  calendar_event: 'Calendar event',
  channel: 'Channel',
  channel_message: 'Thread',
  chat: 'Chat',
  document: 'Document',
  email: 'Email',
  email_thread: 'Email',
  foreign: 'GitHub',
  foreign_entity: 'GitHub',
  reminder: 'Reminder',
  team: 'Team',
};

export function mutedEntityTypeLabel(itemType: string): string {
  return MUTED_ENTITY_TYPE_LABELS[itemType] ?? itemType.replace(/_/g, ' ');
}
