import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { Property } from '@property/types';
import { For } from 'solid-js';
import { InboxItem, type InboxItem as InboxItemData } from './InboxItem';
import { InboxItemLayout } from './layouts/InboxItemLayout';

type ExampleGroup = {
  label: string;
  items: InboxItemData[];
};

const createdAt = new Date(0).toISOString();
const systemOwner = { scope: 'system' } as const;

const statusOptions = [
  { id: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED, label: 'Todo' },
  { id: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS, label: 'In progress' },
  { id: PROPERTY_OPTION_IDS.STATUS.IN_REVIEW, label: 'In review' },
  { id: PROPERTY_OPTION_IDS.STATUS.COMPLETED, label: 'Done' },
];

const priorityOptions = [
  { id: PROPERTY_OPTION_IDS.PRIORITY.LOW, label: 'Low' },
  { id: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM, label: 'Medium' },
  { id: PROPERTY_OPTION_IDS.PRIORITY.HIGH, label: 'High' },
  { id: PROPERTY_OPTION_IDS.PRIORITY.URGENT, label: 'Urgent' },
];

const selectProperty = (args: {
  propertyDefinitionId: string;
  displayName: string;
  value: string;
  options: Array<{ id: string; label: string }>;
}): Property => ({
  propertyId: args.propertyDefinitionId,
  propertyDefinitionId: args.propertyDefinitionId,
  displayName: args.displayName,
  isMultiSelect: false,
  isMetadata: false,
  isSystemProperty: true,
  isRequired: args.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS,
  options: args.options.map((option, displayOrder) => ({
    id: option.id,
    property_definition_id: args.propertyDefinitionId,
    value: { type: 'string', value: option.label },
    display_order: displayOrder,
    created_at: createdAt,
    updated_at: createdAt,
  })),
  owner: systemOwner,
  createdAt,
  updatedAt: createdAt,
  valueType: 'SELECT_STRING',
  value: [args.value],
});

const statusProperty = (value: string): Property =>
  selectProperty({
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
    displayName: 'Status',
    value,
    options: statusOptions,
  });

const priorityProperty = (value: string): Property =>
  selectProperty({
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY,
    displayName: 'Priority',
    value,
    options: priorityOptions,
  });

const exampleGroups: ExampleGroup[] = [
  {
    label: 'Email',
    items: [
      {
        id: 'email-unread',
        notificationId: 'notif-email-unread',
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
        id: 'email-read-long-snippet',
        notificationId: 'notif-email-read-long-snippet',
        notificationType: 'new_email',
        entityId: 'thread-customer-feedback',
        entityType: 'email',
        entityName: 'Customer feedback from design partners',
        senderName: 'Elena Park',
        content:
          'Forwarding the notes from the pilot customers. The main theme is that notification grouping needs to feel predictable.',
        timestamp: '47m',
      },
    ],
  },
  {
    label: 'Channels',
    items: [
      {
        id: 'channel-mention',
        notificationId: 'notif-channel-mention',
        notificationType: 'channel_mention',
        entityId: 'channel-design-system',
        entityType: 'channel',
        entityName: 'Design System',
        unread: true,
        senderName: 'Priya',
        action: 'mentioned you',
        content:
          '“Can we reuse the same primitive for tasks and notifications?”',
        timestamp: '6m',
      },
      {
        id: 'channel-message-send',
        notificationId: 'notif-channel-message-send',
        notificationType: 'channel_message_send',
        entityId: 'channel-product',
        entityType: 'channel',
        entityName: 'Product',
        senderName: 'Riley',
        action: 'sent a message',
        content: 'I pushed the latest mocks for the notification inbox.',
        timestamp: '9m',
      },
      {
        id: 'channel-message-reply',
        notificationId: 'notif-channel-message-reply',
        notificationType: 'channel_message_reply',
        entityId: 'channel-product',
        entityType: 'channel',
        entityName: 'Product',
        senderName: 'Sam',
        action: 'replied',
        content: 'This should also work for grouped channel threads.',
        timestamp: '12m',
      },
      {
        id: 'channel-invite',
        notificationId: 'notif-channel-invite',
        notificationType: 'channel_invite',
        entityId: 'channel-infra',
        entityType: 'channel',
        entityName: 'Infrastructure',
        senderName: 'Casey',
        action: 'invited you to',
        context: 'Private channel',
        timestamp: '18m',
      },
    ],
  },
  {
    label: 'Documents and comments',
    items: [
      {
        id: 'document-mention',
        notificationId: 'notif-document-mention',
        notificationType: 'document_mention',
        entityId: 'doc-notification-inbox-proposal',
        entityType: 'document',
        entityName: 'Notification Inbox Proposal',
        senderName: 'Nina',
        action: 'mentioned you',
        context: 'Projects / Inbox refresh',
        timestamp: '31m',
      },
      {
        id: 'document-comment-mention',
        notificationId: 'notif-document-comment-mention',
        notificationType: 'mentioned_in_document_comment',
        entityId: 'doc-q3-plan',
        entityType: 'document',
        entityName: 'Q3 Launch Plan',
        unread: true,
        senderName: 'Morgan',
        action: 'mentioned you in a comment',
        content: 'Can you confirm the dependency list before Friday?',
        context: 'Project planning',
        timestamp: '42m',
      },
      {
        id: 'document-comment-reply',
        notificationId: 'notif-document-comment-reply',
        notificationType: 'replied_to_document_comment_thread',
        entityId: 'doc-release-notes',
        entityType: 'document',
        entityName: 'Release Notes',
        senderName: 'Devon',
        action: 'replied',
        content: 'I updated the changelog section with the migration notes.',
        context: 'Docs / Releases',
        timestamp: '55m',
      },
      {
        id: 'document-commented',
        notificationId: 'notif-document-commented',
        notificationType: 'commented_on_document',
        entityId: 'doc-roadmap',
        entityType: 'document',
        entityName: 'Roadmap',
        senderName: 'Avery',
        action: 'commented',
        content: 'Should this move into the next milestone?',
        context: 'Planning / Shared with Product',
        timestamp: '1h',
      },
    ],
  },
  {
    label: 'Tasks with property variants',
    items: [
      {
        id: 'task-high-priority',
        notificationId: 'notif-task-high-priority',
        notificationType: 'task_assigned',
        entityId: 'task-inbox-item',
        entityType: 'document',
        entityName: 'Ship the new inbox item primitive',
        unread: true,
        senderName: 'Alex',
        action: 'assigned you',
        properties: [
          statusProperty(PROPERTY_OPTION_IDS.STATUS.IN_REVIEW),
          priorityProperty(PROPERTY_OPTION_IDS.PRIORITY.HIGH),
        ],
        breadcrumb: ['Projects', 'Inbox refresh'],
        timestamp: '2h',
      },
      {
        id: 'task-due-today',
        notificationId: 'notif-task-due-today',
        notificationType: 'task_assigned',
        entityId: 'task-preview-selection',
        entityType: 'document',
        entityName: 'Wire row selection into preview panel',
        senderName: 'Marin',
        action: 'assigned you',
        properties: [
          statusProperty(PROPERTY_OPTION_IDS.STATUS.NOT_STARTED),
          priorityProperty(PROPERTY_OPTION_IDS.PRIORITY.URGENT),
        ],
        breadcrumb: ['Product', 'Inbox'],
        timestamp: '3h',
      },
      {
        id: 'task-low-priority',
        notificationId: 'notif-task-low-priority',
        notificationType: 'task_assigned',
        entityId: 'task-copy-polish',
        entityType: 'document',
        entityName: 'Polish empty state copy',
        senderName: 'Quinn',
        action: 'assigned you',
        properties: [
          statusProperty(PROPERTY_OPTION_IDS.STATUS.NOT_STARTED),
          priorityProperty(PROPERTY_OPTION_IDS.PRIORITY.LOW),
        ],
        breadcrumb: ['Shared', 'Polish'],
        timestamp: '5h',
      },
    ],
  },
  {
    label: 'GitHub pull requests',
    items: [
      {
        id: 'github-pr-opened',
        notificationId: 'notif-github-pr-opened',
        notificationType: 'github_pr_status_changed',
        githubStatus: 'open',
        entityId: 'github-pr-2840',
        entityType: 'foreign',
        entityName: 'Add notification inbox primitives',
        senderName: 'Jordan',
        action: 'opened',
        context: 'macro/app#2840',
        timestamp: '4h',
      },
      {
        id: 'github-pr-merged',
        notificationId: 'notif-github-pr-merged',
        notificationType: 'github_pr_status_changed',
        githubStatus: 'merged',
        entityId: 'github-pr-2839',
        entityType: 'foreign',
        entityName: 'Lazy-load notification preview data',
        senderName: 'Iris',
        action: 'merged',
        context: 'macro/app#2839',
        timestamp: '4h',
      },
      {
        id: 'github-pr-closed',
        notificationId: 'notif-github-pr-closed',
        notificationType: 'github_pr_status_changed',
        githubStatus: 'closed',
        entityId: 'github-pr-2838',
        entityType: 'foreign',
        entityName: 'Remove old inbox experiment flag',
        senderName: 'Kai',
        action: 'closed',
        context: 'macro/app#2838',
        timestamp: '4h',
      },
      {
        id: 'github-review-requested',
        notificationId: 'notif-github-review-requested',
        notificationType: 'github_review_requested',
        entityId: 'github-pr-2841',
        entityType: 'foreign',
        entityName: 'Fix notification inbox layout jitter',
        senderName: 'Jordan',
        action: 'requested your review',
        context: 'macro/app#2841',
        timestamp: '4h',
      },
      {
        id: 'github-pr-comment',
        notificationId: 'notif-github-pr-comment',
        notificationType: 'github_pr_comment',
        entityId: 'github-pr-2842',
        entityType: 'foreign',
        entityName: 'Refactor inbox adapters',
        senderName: 'Mina',
        action: 'commented',
        content: 'Could we keep the adapter output flatter here?',
        context: 'macro/app#2842',
        timestamp: '5h',
      },
      {
        id: 'github-pr-mention',
        notificationId: 'notif-github-pr-mention',
        notificationType: 'github_pr_mention',
        entityId: 'github-pr-2843',
        entityType: 'foreign',
        entityName: 'Preview panel wiring',
        senderName: 'Noah',
        action: 'mentioned you',
        content: '@you can you take a look at the preview selection state?',
        context: 'macro/app#2843',
        timestamp: '6h',
      },
      {
        id: 'github-pr-review',
        notificationId: 'notif-github-pr-review',
        notificationType: 'github_pr_review',
        entityId: 'github-pr-2844',
        entityType: 'foreign',
        entityName: 'Notification inbox grouping',
        senderName: 'Iris',
        action: 'approved',
        content: 'Looks good with a few small comments.',
        context: 'macro/app#2844',
        timestamp: '7h',
      },
    ],
  },
  {
    label: 'AI, calls, and team invites',
    items: [
      {
        id: 'ai-response',
        notificationId: 'notif-ai-response',
        notificationType: 'ai_response',
        entityId: 'chat-ai-response',
        entityType: 'chat',
        entityName: 'AI response ready',
        unread: true,
        senderName: 'AI response',
        action: 'is ready',
        content: 'Summarized the discussion and drafted follow-up tasks.',
        timestamp: '3h',
      },
      {
        id: 'call-started',
        notificationId: 'notif-call-started',
        notificationType: 'call-started',
        entityId: 'call-standup',
        entityType: 'call',
        entityName: 'Engineering Daily',
        senderName: 'Standup call',
        action: 'started',
        timestamp: 'now',
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
        timestamp: '24m',
      },
    ],
  },
];

export function NotificationInbox2() {
  return (
    <div class="size-full min-h-0 bg-surface p-2" data-list-view="inbox2">
      <div class="size-full flex flex-col items-center gap-3 overflow-y-auto">
        <For each={exampleGroups}>
          {(group) => (
            <section class="flex w-full max-w-sm flex-col gap-1">
              <div class="sticky top-0 z-1 bg-surface py-1">
                <span class="px-2 text-[11px] font-medium uppercase tracking-wide text-ink-extra-muted">
                  {group.label}
                </span>
              </div>
              <For each={group.items}>
                {(item) => (
                  <InboxItem.Root
                    item={item}
                    density={
                      item.notificationType === 'task_assigned' ||
                      item.notificationType === 'call-started'
                        ? 'compact'
                        : 'default'
                    }
                    tone="default"
                  >
                    <InboxItemLayout />
                  </InboxItem.Root>
                )}
              </For>
            </section>
          )}
        </For>
      </div>
    </div>
  );
}
