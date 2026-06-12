import { For } from 'solid-js';
import { InboxItem, type InboxItem as InboxItemData } from './InboxItem';
import { InboxItemLayout } from './layouts/InboxItemLayout';

const exampleItems: InboxItemData[] = [
  {
    id: 'email-planning',
    notificationId: 'notif-email-planning',
    notificationType: 'new_email',
    entityId: 'thread-planning',
    entityType: 'email',
    entityName: 'Quarterly planning notes and next steps for the launch',
    unread: true,
    senderName: 'Maya Chen',
    content: 'Can you review the timeline before our afternoon sync?',
    timestamp: '2m',
  },
  {
    id: 'github-review',
    notificationId: 'notif-github-review',
    notificationType: 'github_review_requested',
    entityId: 'github-pr-2841',
    entityType: 'foreign',
    entityName: 'Fix notification inbox layout jitter',
    senderName: 'Jordan',
    action: 'requested your review on',
    context: 'macro/app#2841',
    timestamp: '14m',
  },
  {
    id: 'channel-mention',
    notificationId: 'notif-channel-mention',
    notificationType: 'channel_mention',
    entityId: 'channel-design-system',
    entityType: 'channel',
    entityName: 'Design System',
    unread: true,
    senderName: 'Priya',
    action: 'mentioned you in',
    content: '“Can we reuse the same primitive for tasks and notifications?”',
    timestamp: '31m',
  },
  {
    id: 'team-invite',
    notificationId: 'notif-team-invite',
    notificationType: 'invite_to_team',
    entityId: 'team-product-engineering',
    entityName: 'Product Engineering',
    senderName: 'Taylor',
    action: 'invited you to',
    context: 'Join to see shared channels, docs, and tasks.',
    timestamp: '1h',
  },
  {
    id: 'task-assigned',
    notificationId: 'notif-task-assigned',
    notificationType: 'task_assigned',
    entityId: 'task-inbox-item',
    entityType: 'document',
    entityName: 'Ship the new inbox item primitive',
    senderName: 'Alex',
    action: 'assigned you',
    timestamp: '2h',
  },
  {
    id: 'document-mention',
    notificationId: 'notif-document-mention',
    notificationType: 'document_mention',
    entityId: 'doc-notification-inbox-proposal',
    entityType: 'document',
    entityName: 'Notification Inbox Proposal',
    senderName: 'Nina',
    action: 'mentioned you in',
    context: '“The row component should work for every entity preview.”',
    timestamp: '3h',
  },
  {
    id: 'ai-response',
    notificationId: 'notif-ai-response',
    notificationType: 'ai_response',
    entityId: 'chat-ai-response',
    entityType: 'chat',
    unread: true,
    senderName: 'AI response',
    action: 'is ready',
    content: 'Summarized the discussion and drafted follow-up tasks.',
    timestamp: '4h',
  },
  {
    id: 'call-started',
    notificationId: 'notif-call-started',
    notificationType: 'call-started',
    entityId: 'call-standup',
    entityType: 'call',
    entityName: 'Engineering Daily',
    senderName: 'Standup call',
    action: 'started in',
    timestamp: 'now',
  },
];

export function NotificationInbox2() {
  return (
    <div class="size-full bg-surface p-2" data-list-view="inbox2">
      <div class="flex w-full flex-col gap-1">
        <For each={exampleItems}>
          {(item) => (
            <InboxItem.Root
              item={item}
              density={
                item.notificationType === 'task_assigned' ||
                item.notificationType === 'call-started'
                  ? 'compact'
                  : 'default'
              }
              tone={
                item.notificationType === 'task_assigned' ||
                item.notificationType === 'ai_response'
                  ? 'muted'
                  : 'default'
              }
            >
              <InboxItemLayout />
            </InboxItem.Root>
          )}
        </For>
      </div>
    </div>
  );
}
