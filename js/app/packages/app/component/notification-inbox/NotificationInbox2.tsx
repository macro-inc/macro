import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { PreviewPanel } from '@app/component/PreviewPanel';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { Resize } from '@core/component/Resize';
import type { EntityData } from '@entity';
import type { UnifiedNotification } from '@notifications';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import { Button, cn } from '@ui';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { InboxItem, type InboxItem as InboxItemData } from './InboxItem';
import { InboxItemLayout } from './layouts/InboxItemLayout';
import {
  notificationAction,
  notificationContent,
  notificationSenderName,
  notificationTitle,
} from './notification-extractors';
import {
  getChannelGroupKey,
  getChannelNode,
  getChannelThreadId,
  getDateGroupKey,
  getDateGroupLabel,
  getNotificationGroupKey,
  getNotificationTime,
  isChannelNotification,
  sortNotifications,
} from './notification-utils';

type InboxDateGroup = {
  id: string;
  label: string;
  items: InboxItemData[];
};

type NotificationTag = UnifiedNotification['notification_metadata']['tag'];

type DevNotificationFilter = {
  id: string;
  label: string;
  tags: NotificationTag[];
};

const devNotificationFilters: DevNotificationFilter[] = [
  { id: 'email', label: 'Email', tags: ['new_email'] },
  {
    id: 'channels',
    label: 'Channels',
    tags: ['channel_mention', 'channel_message_send', 'channel_message_reply'],
  },
  {
    id: 'invites',
    label: 'Invites',
    tags: ['channel_invite', 'invite_to_team'],
  },
  {
    id: 'documents',
    label: 'Docs',
    tags: [
      'document_mention',
      'mentioned_in_document_comment',
      'replied_to_document_comment_thread',
      'commented_on_document',
    ],
  },
  { id: 'tasks', label: 'Tasks', tags: ['task_assigned'] },
  { id: 'ai', label: 'AI', tags: ['ai_response'] },
  {
    id: 'github',
    label: 'GitHub',
    tags: [
      'github_pr_status_changed',
      'github_review_requested',
      'github_pr_comment',
      'github_pr_mention',
      'github_pr_review',
    ],
  },
];

const transformNotificationItem = (args: {
  id: string;
  notification: UnifiedNotification;
  subItems?: UnifiedNotification[];
}): InboxItemData => {
  const title = notificationTitle(args.notification);
  const showSubItems =
    args.notification.notification_metadata.tag !== 'github_pr_status_changed';

  return {
    id: args.id,
    notification: args.notification,
    entityId: args.notification.entity_id,
    entityType: args.notification.entity_type as InboxItemData['entityType'],
    entityName: title,
    senderId: args.notification.sender_id ?? undefined,
    senderName: notificationSenderName(args.notification),
    action: notificationAction(args.notification),
    targetName: title,
    content: notificationContent(args.notification),
    timestamp: args.notification.created_at ?? args.notification.updated_at,
    unread: !args.notification.viewed_at && !args.notification.done,
    subItems: showSubItems
      ? args.subItems?.map((subItem) =>
          transformNotificationItem({
            id: `notification:${subItem.id}`,
            notification: subItem,
          })
        )
      : undefined,
  };
};

const groupInboxItemsByDate = (items: InboxItemData[]): InboxDateGroup[] => {
  const groups = new Map<string, InboxDateGroup>();

  for (const item of items) {
    const notification = item.notification;
    if (!notification) continue;

    const time = getNotificationTime(notification as UnifiedNotification);
    const id = getDateGroupKey(time);
    const existing = groups.get(id);

    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(id, {
      id,
      label: getDateGroupLabel(time),
      items: [item],
    });
  }

  return Array.from(groups.values()).toSorted(
    (a, b) =>
      getNotificationTime(b.items[0].notification as UnifiedNotification) -
      getNotificationTime(a.items[0].notification as UnifiedNotification)
  );
};

const buildInboxItems = (
  notifications: UnifiedNotification[]
): InboxItemData[] => {
  const sorted = sortNotifications(notifications);
  const groupedNotifications = new Map<string, UnifiedNotification[]>();
  const referencedChannelThreadIds = new Set<string>();
  const items: InboxItemData[] = [];
  let currentChannelGroupKey: string | undefined;
  let currentChannelCompositeKey: string | undefined;

  for (const notification of sorted) {
    const threadId = getChannelThreadId(notification);
    if (threadId) {
      referencedChannelThreadIds.add(getChannelNode(notification, threadId));
    }
  }

  for (const notification of sorted) {
    const groupKey = getNotificationGroupKey(notification);
    if (groupKey) {
      currentChannelGroupKey = undefined;
      currentChannelCompositeKey = undefined;
      groupedNotifications.set(groupKey, [
        ...(groupedNotifications.get(groupKey) ?? []),
        notification,
      ]);
      continue;
    }

    if (isChannelNotification(notification)) {
      const channelGroupKey = getChannelGroupKey(
        notification,
        referencedChannelThreadIds
      );
      if (currentChannelGroupKey !== channelGroupKey) {
        currentChannelGroupKey = channelGroupKey;
        currentChannelCompositeKey = `channel:${channelGroupKey}:${notification.id}`;
      }

      const compositeKey = currentChannelCompositeKey;
      if (!compositeKey) continue;

      groupedNotifications.set(compositeKey, [
        ...(groupedNotifications.get(compositeKey) ?? []),
        notification,
      ]);
      continue;
    }

    currentChannelGroupKey = undefined;
    currentChannelCompositeKey = undefined;

    items.push(
      transformNotificationItem({
        id: `notification:${notification.id}`,
        notification,
      })
    );
  }

  for (const [key, group] of groupedNotifications) {
    const notifications = sortNotifications(group);
    items.push(
      transformNotificationItem({
        id: key,
        notification: notifications[0],
        subItems: notifications.slice(1),
      })
    );
  }

  return items.toSorted(
    (a, b) =>
      getNotificationTime(b.notification as UnifiedNotification) -
      getNotificationTime(a.notification as UnifiedNotification)
  );
};

const buildInboxGroups = (
  notifications: UnifiedNotification[]
): InboxDateGroup[] => groupInboxItemsByDate(buildInboxItems(notifications));

const getNotificationDateValue = (
  notification: UnifiedNotification
): string | null => notification.created_at ?? notification.updated_at ?? null;

const getChannelPreviewEntity = (
  notification: UnifiedNotification
): EntityData | undefined => {
  const metadata = notification.notification_metadata;

  if (
    metadata.tag !== 'channel_message_send' &&
    metadata.tag !== 'channel_message_reply' &&
    metadata.tag !== 'channel_mention'
  ) {
    return undefined;
  }

  const channelType =
    metadata.content.channelType === 'directMessage'
      ? 'direct_message'
      : metadata.content.channelType;
  const senderId =
    metadata.tag === 'channel_message_reply'
      ? metadata.content.userId
      : (notification.sender_id ?? undefined);
  const date = getNotificationDateValue(notification);

  return {
    id: metadata.content.messageId,
    type: 'channel_message',
    name: metadata.content.messageContent || metadata.content.channelName || '',
    ownerId: '',
    createdAt: date,
    updatedAt: date,
    channelId: notification.entity_id,
    channelName: metadata.content.channelName ?? 'Channel',
    channelType:
      channelType === 'direct_message' ? 'direct_message' : channelType,
    messageId: metadata.content.messageId,
    threadId:
      metadata.tag === 'channel_message_reply' ||
      metadata.tag === 'channel_mention'
        ? (metadata.content.threadId ?? undefined)
        : undefined,
    senderId: senderId ?? '',
    content: metadata.content.messageContent ?? '',
  } as EntityData;
};

function previewEntity(item: InboxItemData): EntityData | undefined {
  const notification = item.notification as UnifiedNotification | undefined;
  if (!notification) return undefined;

  const channelEntity = getChannelPreviewEntity(notification);
  if (channelEntity) return channelEntity;

  const metadata = notification.notification_metadata;
  const date = getNotificationDateValue(notification);

  switch (metadata.tag) {
    case 'new_email':
      return {
        id: notification.entity_id,
        type: 'email',
        name: metadata.content.subject || 'Email',
        ownerId: '',
        createdAt: date,
        updatedAt: date,
        viewedAt: notification.viewed_at ?? null,
        isRead: !!notification.viewed_at,
        isDraft: false,
        snippet: metadata.content.snippet ?? undefined,
        isImportant: false,
        done: !!notification.done,
        senderEmail: metadata.content.sender ?? undefined,
        senderName: metadata.content.sender ?? undefined,
      } as EntityData;
    case 'task_assigned':
      return {
        id: notification.entity_id,
        type: 'document',
        name: metadata.content.taskName ?? 'Task',
        ownerId: '',
        createdAt: date,
        updatedAt: date,
        viewedAt: notification.viewed_at ?? null,
        fileType: 'md',
        subType: { type: 'task' },
      } as EntityData;
    case 'document_mention':
    case 'mentioned_in_document_comment':
    case 'replied_to_document_comment_thread':
    case 'commented_on_document':
      return {
        id: notification.entity_id,
        type: 'document',
        name: metadata.content.documentName ?? 'Document',
        ownerId: '',
        createdAt: date,
        updatedAt: date,
        viewedAt: notification.viewed_at ?? null,
        fileType: metadata.content.fileType ?? 'md',
        subType: metadata.content.subType ?? null,
      } as EntityData;
    case 'ai_response':
      return {
        id: notification.entity_id,
        type: 'chat',
        name: metadata.content.summary || 'AI response',
        ownerId: '',
        createdAt: date,
        updatedAt: date,
        viewedAt: notification.viewed_at ?? null,
      } as EntityData;
    default:
      if (!item.entityId || !item.entityType) return undefined;

      return {
        id: item.entityId,
        type: item.entityType,
        name: item.entityName || item.targetName || 'Preview',
        ownerId: '',
        createdAt: date,
        updatedAt: date,
      } as EntityData;
  }
}

function itemDensity(item: InboxItemData) {
  const tag = item.notification?.notification_metadata.tag;
  if (tag === 'task_assigned' || tag === 'call-started') return 'compact';
  return 'default';
}

function NotificationInboxList(props: {
  groups: InboxDateGroup[];
  hiddenFilterIds: string[];
  selectedItem: InboxItemData | undefined;
  onSelect: (item: InboxItemData) => void;
  onToggleFilter: (filterId: string) => void;
}) {
  return (
    <div class="flex size-full min-h-0 flex-col bg-surface p-2">
      <div class="mb-2 flex shrink-0 flex-wrap gap-1">
        <For each={devNotificationFilters}>
          {(filter) => {
            const hidden = () => props.hiddenFilterIds.includes(filter.id);

            return (
              <Button
                class="h-7 bg-surface"
                depth={2}
                size="sm"
                variant={hidden() ? 'active' : 'base'}
                onClick={() => props.onToggleFilter(filter.id)}
              >
                {hidden() ? 'Show' : 'Hide'} {filter.label}
              </Button>
            );
          }}
        </For>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="flex min-h-full flex-col gap-3 pb-2">
          <For each={props.groups}>
            {(group) => (
              <section class="flex w-full flex-col gap-1">
                <header class="sticky top-0 z-1 bg-active py-2 px-3 rounded-md flex items-center gap-1">
                  <CalendarIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
                  <h1 class="text-sm text-ink">{group.label}</h1>
                </header>
                <For each={group.items}>
                  {(item) => (
                    <InboxItem.Root
                      density={itemDensity(item)}
                      item={item}
                      selected={props.selectedItem?.id === item.id}
                      tone="default"
                    >
                      <InboxItemLayout onClick={() => props.onSelect(item)} />
                    </InboxItem.Root>
                  )}
                </For>
              </section>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

export function NotificationInbox2() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const notificationSource = useGlobalNotificationSource();
  const [hiddenFilterIds, setHiddenFilterIds] = createSignal<string[]>([]);
  const hiddenTags = createMemo(() => {
    const ids = new Set(hiddenFilterIds());
    return new Set(
      devNotificationFilters
        .filter((filter) => ids.has(filter.id))
        .flatMap((filter) => filter.tags)
    );
  });
  const groups = createMemo(() =>
    buildInboxGroups(
      notificationSource
        .notifications()
        .filter((notification) => !notification.deleted_at)
        .filter(
          (notification) =>
            !hiddenTags().has(notification.notification_metadata.tag)
        )
    )
  );
  const toggleFilter = (filterId: string) => {
    setHiddenFilterIds((ids) =>
      ids.includes(filterId)
        ? ids.filter((id) => id !== filterId)
        : [...ids, filterId]
    );
  };
  const [selectedItem, setSelectedItem] = createSignal<
    InboxItemData | undefined
  >();
  const selectedEntity = () => {
    const item = selectedItem();
    if (!item) return undefined;
    return previewEntity(item);
  };
  const previewVisible = () => true;

  createEffect(() => {
    const [getPreview, setPreview] = panel.previewState;
    if (previewVisible() !== getPreview()) setPreview(previewVisible());
  });

  return (
    <div class="relative size-full min-h-0 bg-surface" data-list-view="inbox2">
      <Resize.Zone direction="horizontal" gutter={0}>
        <Resize.Panel
          id="notification-inbox-list"
          maxSize={previewVisible() ? 840 : undefined}
          minSize={200}
        >
          <div
            class={cn(
              'size-full min-w-0 min-h-0',
              previewVisible() && 'border-r border-edge-muted'
            )}
          >
            <NotificationInboxList
              groups={groups()}
              hiddenFilterIds={hiddenFilterIds()}
              onSelect={setSelectedItem}
              onToggleFilter={toggleFilter}
              selectedItem={selectedItem()}
            />
          </div>
        </Resize.Panel>
        <Resize.Panel
          id="notification-inbox-preview"
          minSize={300}
          target={{ kind: 'percent', percent: 70 }}
        >
          <div class="size-full min-h-0 min-w-0">
            <Show
              fallback={
                <div class="flex size-full items-center justify-center text-sm text-ink-extra-muted">
                  Select a notification to preview it
                </div>
              }
              when={selectedEntity()}
            >
              {(entity) => (
                <PreviewPanel
                  orchestrator={orchestrator}
                  selectedEntity={entity()}
                  splitPanelContext={panel}
                />
              )}
            </Show>
          </div>
        </Resize.Panel>
      </Resize.Zone>
    </div>
  );
}
