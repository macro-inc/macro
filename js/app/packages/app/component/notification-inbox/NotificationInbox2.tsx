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
import { cn } from '@ui';
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

function previewEntity(item: InboxItemData): EntityData | undefined {
  if (!item.entityId || !item.entityType) return undefined;

  const name = item.entityName || item.targetName || 'Preview';

  return {
    id: item.entityId,
    type: item.entityType,
    name,
    ownerId: '',
    createdAt: null,
    updatedAt: null,
  } as EntityData;
}

function itemDensity(item: InboxItemData) {
  const tag = item.notification?.notification_metadata.tag;
  if (tag === 'task_assigned' || tag === 'call-started') return 'compact';
  return 'default';
}

function NotificationInboxList(props: {
  groups: InboxDateGroup[];
  selectedItem: InboxItemData | undefined;
  onSelect: (item: InboxItemData) => void;
}) {
  return (
    <div class="size-full min-h-0 bg-surface p-2">
      <div class="size-full flex flex-col gap-3 overflow-y-auto">
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
  );
}

export function NotificationInbox2() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const notificationSource = useGlobalNotificationSource();
  const groups = createMemo(() =>
    buildInboxGroups(
      notificationSource
        .notifications()
        .filter((notification) => !notification.deleted_at)
    )
  );
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
    <div class="size-full min-h-0 bg-surface" data-list-view="inbox2">
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
              onSelect={setSelectedItem}
              selectedItem={selectedItem()}
            />
          </div>
        </Resize.Panel>
        <Resize.Panel
          id="notification-inbox-preview"
          minSize={300}
          target={{ kind: 'percent', percent: 70 }}
        >
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
        </Resize.Panel>
      </Resize.Zone>
    </div>
  );
}
