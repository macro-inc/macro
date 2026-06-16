import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { PreviewPanel } from '@app/component/PreviewPanel';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { Resize } from '@core/component/Resize';
import { TabsInset } from '@core/component/TabsInset';
import type { EntityData } from '@entity';
import type { UnifiedNotification } from '@notifications';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ArrowSquareOutIcon from '@phosphor-icons/core/regular/arrow-square-out.svg?component-solid';
import { Button, cn } from '@ui';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { InboxItem, type InboxItem as InboxItemData } from './InboxItem';
import { InboxItemInlineTypeLayout } from './layouts/InboxItemInlineTypeLayout';
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

type InboxListRow =
  | { type: 'header'; id: string; label: string }
  | { type: 'item'; id: string; item: InboxItemData };

type NotificationTag = UnifiedNotification['notification_metadata']['tag'];

type ReadFilter = 'all' | 'unread' | 'read';

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

function getGithubUrl(item: InboxItemData) {
  const metadata = item.notification?.notification_metadata;
  if (
    metadata?.tag !== 'github_pr_status_changed' &&
    metadata?.tag !== 'github_review_requested' &&
    metadata?.tag !== 'github_pr_comment' &&
    metadata?.tag !== 'github_pr_mention' &&
    metadata?.tag !== 'github_pr_review'
  ) {
    return undefined;
  }

  return `https://github.com/${metadata.content.owner}/${metadata.content.repo}/pull/${metadata.content.number}`;
}

function GithubPreviewFallback(props: { item: InboxItemData }) {
  const url = () => getGithubUrl(props.item);

  return (
    <div class="flex size-full items-center justify-center p-6">
      <div class="flex max-w-sm flex-col items-center gap-3 text-center">
        <div class="flex flex-col gap-1">
          <div class="text-sm font-medium text-ink">PR block coming soon</div>
          <p class="text-xs text-ink-muted">
            GitHub pull request previews are not available here yet.
          </p>
        </div>
        <Show when={url()}>
          {(href) => (
            <a
              class="inline-flex h-7 items-center gap-1 rounded-md border border-edge-muted bg-active px-2 text-xs text-ink-muted shadow-sm transition-colors hover:bg-hover hover:text-ink active:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              href={href()}
              rel="noreferrer"
              target="_blank"
            >
              Open in GitHub
              <ArrowSquareOutIcon class="size-4" />
            </a>
          )}
        </Show>
      </div>
    </div>
  );
}

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

function NotificationInboxList(props: {
  groups: InboxDateGroup[];
  hiddenFilterIds: string[];
  readFilter: ReadFilter;
  selectedItem: InboxItemData | undefined;
  onReadFilterChange: (filter: ReadFilter) => void;
  onSelect: (item: InboxItemData) => void;
  onToggleFilter: (filterId: string) => void;
}) {
  const [showDevFilters, setShowDevFilters] = createSignal(false);

  const [layoutVariant, setLayoutVariant] = createSignal<
    'default' | 'inline-type'
  >('default');

  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();

  const rows = createMemo<InboxListRow[]>(() =>
    props.groups.flatMap((group) => [
      { type: 'header' as const, id: group.id, label: group.label },
      ...group.items.map((item) => ({
        type: 'item' as const,
        id: item.id,
        item,
      })),
    ])
  );

  const [scrollOffset, setScrollOffset] = createSignal(0);

  const currentHeader = () => {
    const handle = virtualHandle();
    const firstIndex = handle?.findItemIndex(scrollOffset()) ?? 0;
    const header = rows()
      .slice(0, firstIndex + 1)
      .findLast((row) => row.type === 'header');

    return header?.label;
  };

  const [focusedIndex, setFocusedIndex] = createSignal(-1);

  let lastFocusedRowId: string | undefined;

  const rowIndexForItem = (item: InboxItemData) =>
    rows().findIndex((row) => row.type === 'item' && row.item.id === item.id);

  const focusedRow = () => {
    const index = focusedIndex();
    if (index === -1) return undefined;

    const row = rows()[index];
    return row?.type === 'item' ? row : undefined;
  };

  const shouldSkipRow = (row: InboxListRow) => row.type === 'header';

  const setFocus = (index: number) => {
    const row = rows()[index];
    if (!row || shouldSkipRow(row)) return undefined;

    setFocusedIndex(index);
    lastFocusedRowId = row.id;
    virtualHandle()?.scrollToIndex(index, { align: 'nearest' });
    return row;
  };

  const findNextIndex = (startIndex: number, offset: number) => {
    const list = rows();
    if (!list.length) return -1;

    const direction = offset > 0 ? 1 : -1;
    let cursor = startIndex;

    while (true) {
      cursor += direction;
      if (cursor < 0 || cursor >= list.length) {
        return startIndex;
      }

      const row = list[cursor];
      if (row && !shouldSkipRow(row)) return cursor;
    }
  };

  const navigateBy = (offset: number) => {
    const list = rows();
    if (!list.length) return;

    const current = focusedIndex();
    if (current === -1) {
      const direction = offset > 0 ? 1 : -1;
      let index = offset > 0 ? 0 : list.length - 1;
      while (index >= 0 && index < list.length && shouldSkipRow(list[index])) {
        index += direction;
      }
      if (index < 0 || index >= list.length) return;
      setFocus(index);
      return;
    }

    const nextIndex = findNextIndex(current, offset);
    if (nextIndex !== -1) setFocus(nextIndex);
  };

  const selectCurrent = () => {
    const row = focusedRow();
    if (row) {
      props.onSelect(row.item);
      return;
    }

    const firstRow = rows().find((row) => row.type === 'item');
    if (!firstRow) return;

    setFocus(rowIndexForItem(firstRow.item));
    props.onSelect(firstRow.item);
  };

  createEffect(() => {
    if (!lastFocusedRowId) return;

    const index = rows().findIndex((row) => row.id === lastFocusedRowId);
    setFocusedIndex(index);
    if (index < 0) lastFocusedRowId = undefined;
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest('button,a,input,textarea,select,[contenteditable=true]')
    ) {
      return;
    }

    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      navigateBy(1);
      return;
    }

    if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      navigateBy(-1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      selectCurrent();
    }
  };

  return (
    <div
      class="flex size-full min-h-0 flex-col bg-surface p-2 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div class="mb-2 flex shrink-0 flex-col gap-2">
        <TabsInset
          class="h-auto w-fit"
          list={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread' },
            { value: 'read', label: 'Read' },
          ]}
          value={props.readFilter}
          onChange={(value) => props.onReadFilterChange(value as ReadFilter)}
        />
        <div class="flex gap-1">
          <Button
            class="h-7 w-fit bg-surface text-ink-muted"
            depth={2}
            size="sm"
            variant="base"
            onClick={() => setShowDevFilters((value) => !value)}
          >
            Dev filters
          </Button>
          <Button
            class="h-7 w-fit bg-surface text-ink-muted"
            depth={2}
            size="sm"
            variant={layoutVariant() === 'inline-type' ? 'active' : 'base'}
            onClick={() =>
              setLayoutVariant((value) =>
                value === 'inline-type' ? 'default' : 'inline-type'
              )
            }
          >
            Inline type layout
          </Button>
        </div>
        <Show when={showDevFilters()}>
          <div class="flex flex-wrap gap-1 rounded-md border border-dashed border-edge-muted bg-ink-muted/2.5 p-1">
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
        </Show>
      </div>
      <div class="flex min-h-0 flex-1 flex-col">
        <Show when={currentHeader()}>
          {(label) => (
            <header class="flex shrink-0 items-center gap-1 bg-surface px-2 py-4">
              <CalendarIcon class="size-3 shrink-0 text-ink-extra-muted" />
              <h1 class="text-xs font-medium text-ink-extra-muted">
                {label()}
              </h1>
            </header>
          )}
        </Show>
        <VList
          ref={setVirtualHandle}
          data={rows()}
          class="min-h-0 flex-1 scrollbar-hidden"
          style={{ height: '100%', width: '100%' }}
          onScroll={setScrollOffset}
        >
          {(row) => {
            if (row.type === 'header') {
              return (
                <Show when={row.label !== currentHeader()}>
                  <header class="mt-3 flex items-center gap-1 bg-surface px-2 py-4 first:mt-0">
                    <CalendarIcon class="size-3 shrink-0 text-ink-extra-muted" />
                    <h1 class="text-xs font-medium text-ink-extra-muted">
                      {row.label}
                    </h1>
                  </header>
                </Show>
              );
            }

            return (
              <div class="pb-1.5">
                <InboxItem.Root
                  highlighted={focusedRow()?.item.id === row.item.id}
                  item={row.item}
                  selected={props.selectedItem?.id === row.item.id}
                >
                  <Show
                    when={layoutVariant() === 'inline-type'}
                    fallback={
                      <InboxItemLayout
                        onClick={() => props.onSelect(row.item)}
                      />
                    }
                  >
                    <InboxItemInlineTypeLayout
                      onClick={() => props.onSelect(row.item)}
                    />
                  </Show>
                </InboxItem.Root>
              </div>
            );
          }}
        </VList>
      </div>
    </div>
  );
}

export function NotificationInbox2() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const notificationSource = useGlobalNotificationSource();
  const [hiddenFilterIds, setHiddenFilterIds] = createSignal<string[]>([]);
  const [readFilter, setReadFilter] = createSignal<ReadFilter>('all');
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
        .filter((notification) => {
          if (readFilter() === 'all') return true;
          const unread = !notification.viewed_at && !notification.done;
          return readFilter() === 'unread' ? unread : !unread;
        })
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
  const selectedGithubUrl = () => {
    const item = selectedItem();
    if (!item) return undefined;
    return getGithubUrl(item);
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
              readFilter={readFilter()}
              onReadFilterChange={setReadFilter}
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
              when={selectedGithubUrl()}
              fallback={
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
              }
            >
              <Show when={selectedItem()}>
                {(item) => <GithubPreviewFallback item={item()} />}
              </Show>
            </Show>
          </div>
        </Resize.Panel>
      </Resize.Zone>
    </div>
  );
}
