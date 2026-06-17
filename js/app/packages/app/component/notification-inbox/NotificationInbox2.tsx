import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';
import { PreviewPanel } from '@app/component/PreviewPanel';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { Resize } from '@core/component/Resize';
import { TabsInset } from '@core/component/TabsInset';
import {
  createHotkeyGroup,
  registerHotkey,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import type { EntityData } from '@entity';
import {
  getSortedKeyProperties,
  soupPropertyToProperty,
} from '@entity/extractors-property/property-helpers';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { Popover } from '@kobalte/core/popover';
import type { UnifiedNotification } from '@notifications';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ArrowSquareOutIcon from '@phosphor-icons/core/regular/arrow-square-out.svg?component-solid';
import SlidersHorizontalIcon from '@phosphor-icons/core/regular/sliders-horizontal.svg?component-solid';
import { useSoupItemsQuery } from '@queries/soup/items';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { Button, cn, Layer } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
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
  | { type: 'item'; id: string; item: InboxItemData; depth: number };

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

type SoupEntityRecord = Record<string, unknown>;

const entityMapKey = (notification: UnifiedNotification) =>
  `${String(notification.entity_type)}:${notification.entity_id}`;

const getNotificationEntity = (
  entityById: Map<string, SoupEntityRecord> | undefined,
  notification: UnifiedNotification
) => entityById?.get(entityMapKey(notification));

const taskProperties = (entity: SoupEntityRecord | undefined) => {
  const properties = entity?.properties;
  if (!Array.isArray(properties)) return undefined;

  const keyProperties = getSortedKeyProperties(
    properties.map((property) =>
      soupPropertyToProperty(property as SoupProperty)
    )
  );
  return keyProperties.length ? keyProperties : undefined;
};

const transformNotificationItem = (args: {
  id: string;
  notification: UnifiedNotification;
  entity?: SoupEntityRecord;
  subItems?: UnifiedNotification[];
  entityById?: Map<string, SoupEntityRecord>;
}): InboxItemData => {
  const metadata = args.notification.notification_metadata;
  const notificationTitleValue = notificationTitle(args.notification);
  const title = metadata.tag.startsWith('channel_')
    ? String(args.entity?.name ?? '') || notificationTitleValue
    : notificationTitleValue || String(args.entity?.name ?? '');
  const showSubItems = metadata.tag !== 'github_pr_status_changed';

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
    content:
      notificationContent(args.notification) ||
      String(args.entity?.snippet ?? ''),
    properties:
      metadata.tag === 'task_assigned'
        ? taskProperties(args.entity)
        : undefined,
    timestamp: args.notification.created_at ?? args.notification.updated_at,
    unread: !args.notification.viewed_at && !args.notification.done,
    subItems: showSubItems
      ? args.subItems?.map((subItem) =>
          transformNotificationItem({
            id: `notification:${subItem.id}`,
            notification: subItem,
            entity: getNotificationEntity(args.entityById, subItem),
            entityById: args.entityById,
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

const getInboxItemGroupKey = (notification: UnifiedNotification) => {
  const metadata = notification.notification_metadata;
  const content = metadata.content as unknown as Record<string, unknown>;

  if (metadata.tag === 'new_email') return `email:${notification.entity_id}`;

  if (isChannelNotification(notification)) {
    return `channel:${notification.entity_id}:${String(content.threadId ?? 'root')}`;
  }

  if (metadata.tag.startsWith('github_')) {
    const owner = String(content.owner ?? '');
    const repo = String(content.repo ?? '');
    const number = String(content.number ?? '');
    if (owner || repo || number) return `github:${owner}/${repo}#${number}`;
  }

  const groupKey = getNotificationGroupKey(notification);
  if (groupKey) return groupKey;

  if (
    metadata.tag === 'mentioned_in_document_comment' ||
    metadata.tag === 'replied_to_document_comment_thread' ||
    metadata.tag === 'commented_on_document' ||
    metadata.tag === 'document_mention'
  ) {
    return `document:${notification.entity_id}:${String(
      content.commentId ?? content.threadId ?? content.blockId ?? 'root'
    )}`;
  }

  return undefined;
};

const buildInboxItems = (
  notifications: UnifiedNotification[],
  entityById = new Map<string, SoupEntityRecord>()
): InboxItemData[] => {
  const groups: UnifiedNotification[][] = [];
  let currentKey: string | undefined;

  for (const notification of sortNotifications(notifications)) {
    const key = getInboxItemGroupKey(notification);
    const current = groups.at(-1);

    if (key && key === currentKey && current) {
      current.push(notification);
      continue;
    }

    currentKey = key;
    groups.push([notification]);
  }

  return groups.map((group) => {
    const notifications = sortNotifications(group);
    const root = notifications[0];
    const groupKey = getInboxItemGroupKey(root);
    const groupDateKey = getDateGroupKey(getNotificationTime(root));

    return transformNotificationItem({
      id:
        group.length > 1
          ? `${groupDateKey}:${groupKey ?? `notification:${root.id}`}`
          : `notification:${root.id}`,
      notification: root,
      entity: getNotificationEntity(entityById, root),
      subItems: group.length > 1 ? notifications : undefined,
      entityById,
    });
  });
};

const buildInboxGroups = (
  notifications: UnifiedNotification[],
  entityById?: Map<string, SoupEntityRecord>
): InboxDateGroup[] =>
  groupInboxItemsByDate(buildInboxItems(notifications, entityById));

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
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [showDevFilters, setShowDevFilters] = createSignal(false);

  const [layoutVariant, setLayoutVariant] = createSignal<
    'default' | 'inline-type'
  >('default');

  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();

  const [expandedItemIds, setExpandedItemIds] = createSignal<string[]>([]);

  const isExpanded = (item: InboxItemData) =>
    expandedItemIds().includes(item.id);

  const setExpanded = (item: InboxItemData, expanded: boolean) => {
    if (!item.subItems?.length) return;

    setExpandedItemIds((ids) => {
      const alreadyExpanded = ids.includes(item.id);
      if (expanded === alreadyExpanded) return ids;
      return expanded ? [...ids, item.id] : ids.filter((id) => id !== item.id);
    });
  };

  const rows = createMemo<InboxListRow[]>(() =>
    props.groups.flatMap((group) => [
      { type: 'header' as const, id: group.id, label: group.label },
      ...group.items.flatMap((item) => [
        { type: 'item' as const, id: item.id, item, depth: 0 },
        ...(isExpanded(item)
          ? (item.subItems ?? []).map((subItem) => ({
              type: 'item' as const,
              id: subItem.id,
              item: subItem,
              depth: 1,
            }))
          : []),
      ]),
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

  const oldestGroupItem = (item: InboxItemData) =>
    (item.subItems ?? []).toSorted(
      (a, b) =>
        getNotificationTime(a.notification as UnifiedNotification) -
        getNotificationTime(b.notification as UnifiedNotification)
    )[0] ?? item;

  const selectItem = (item: InboxItemData) => {
    props.onSelect(item.subItems?.length ? oldestGroupItem(item) : item);
  };

  const selectCurrent = () => {
    const row = focusedRow();
    if (row) {
      selectItem(row.item);
      return;
    }

    const firstRow = rows().find((row) => row.type === 'item');
    if (!firstRow) return;

    setFocus(rowIndexForItem(firstRow.item));
    selectItem(firstRow.item);
  };

  createEffect(() => {
    if (!lastFocusedRowId) return;

    const index = rows().findIndex((row) => row.id === lastFocusedRowId);
    setFocusedIndex(index);
    if (index < 0) lastFocusedRowId = undefined;
  });

  const [attachHotkeys, scopeId] = useHotkeyDOMScope('notification-inbox');
  const group = createHotkeyGroup();

  registerHotkey({
    hotkey: ['j', 'arrowdown'],
    scopeId,
    description: 'Down',
    keyDownHandler: () => {
      navigateBy(1);
      return true;
    },
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['k', 'arrowup'],
    scopeId,
    description: 'Up',
    keyDownHandler: () => {
      navigateBy(-1);
      return true;
    },
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['arrowright'],
    scopeId,
    description: 'Expand item',
    keyDownHandler: () => {
      const row = focusedRow();
      if (row?.depth !== 0 || !row.item.subItems?.length) return false;
      setExpanded(row.item, true);
      return true;
    },
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['arrowleft'],
    scopeId,
    description: 'Collapse item',
    keyDownHandler: () => {
      const row = focusedRow();
      if (row?.depth !== 0 || !row.item.subItems?.length) return false;
      setExpanded(row.item, false);
      return true;
    },
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['enter'],
    scopeId,
    description: 'Open item',
    keyDownHandler: () => {
      selectCurrent();
      return true;
    },
    hide: true,
  }).withGroup(group);

  onCleanup(() => group.dispose());

  return (
    <div
      ref={attachHotkeys}
      class="flex size-full min-h-0 flex-col bg-surface p-2 outline-none"
      tabIndex={0}
    >
      <div class="mb-2 flex shrink-0 items-center gap-2">
        <TabsInset
          class="h-auto w-fit"
          list={[
            { value: 'unread', label: 'Unread' },
            { value: 'read', label: 'Read' },
            { value: 'all', label: 'All' },
          ]}
          value={props.readFilter}
          onChange={(value) => props.onReadFilterChange(value as ReadFilter)}
        />
        <Popover
          gutter={4}
          open={settingsOpen()}
          placement="bottom-end"
          onOpenChange={setSettingsOpen}
        >
          <Popover.Trigger
            as={Button}
            class="ml-auto h-7 bg-surface text-ink-muted"
            depth={2}
            size="icon-sm"
            variant="base"
          >
            <SlidersHorizontalIcon />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="z-popover flex w-72 flex-col gap-2 rounded-lg border border-edge bg-surface p-2 text-sm shadow-lg">
              <Button
                class="h-7 w-full justify-start bg-surface text-ink-muted"
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
              <Button
                class="h-7 w-full justify-start bg-surface text-ink-muted"
                depth={2}
                size="sm"
                variant={showDevFilters() ? 'active' : 'base'}
                onClick={() => setShowDevFilters((value) => !value)}
              >
                Dev filters
              </Button>
              <Show when={showDevFilters()}>
                <div class="flex flex-wrap gap-1 rounded-md border border-dashed border-edge-muted bg-ink-muted/2.5 p-1">
                  <For each={devNotificationFilters}>
                    {(filter) => {
                      const hidden = () =>
                        props.hiddenFilterIds.includes(filter.id);

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
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      </div>
      <div class="flex min-h-0 flex-1 flex-col">
        <Show when={currentHeader()}>
          {(label) => (
            <Layer depth={2}>
              <div class="flex items-center">
                <header class="border border-edge-muted rounded-full w-fit flex items-center gap-1 bg-surface whitespace-nowrap px-3 py-1.5 my-2 mx-auto">
                  <CalendarIcon class="size-3 shrink-0 text-ink-extra-muted" />
                  <h1 class="text-xs font-medium text-ink-extra-muted">
                    {label()}
                  </h1>
                </header>
                <div class="w-full h-px bg-edge-muted" />
              </div>
            </Layer>
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
                  <Layer depth={2}>
                    <div class="flex items-center">
                      <header class="border border-edge-muted rounded-full w-fit flex items-center gap-1 bg-surface whitespace-nowrap px-3 py-1.5 my-2 mx-auto">
                        <CalendarIcon class="size-3 shrink-0 text-ink-extra-muted" />
                        <h1 class="text-xs font-medium text-ink-extra-muted">
                          {row.label}
                        </h1>
                      </header>
                      <div class="w-full h-px bg-edge-muted" />
                    </div>
                  </Layer>
                </Show>
              );
            }

            const onItemClick = () => {
              selectItem(row.item);
            };

            return (
              <div
                class={cn(
                  'pb-1.5',
                  row.depth > 0 && 'ml-2 border-l border-edge-muted pl-4'
                )}
              >
                <InboxItem.Root
                  expanded={isExpanded(row.item)}
                  highlighted={focusedRow()?.item.id === row.item.id}
                  item={row.item}
                  selected={props.selectedItem?.id === row.item.id}
                >
                  <Show
                    when={layoutVariant() === 'inline-type'}
                    fallback={<InboxItemLayout onClick={onItemClick} />}
                  >
                    <InboxItemInlineTypeLayout onClick={onItemClick} />
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
  const [readFilter, setReadFilter] = createSignal<ReadFilter>('unread');
  const hiddenTags = createMemo(() => {
    const ids = new Set(hiddenFilterIds());
    return new Set(
      devNotificationFilters
        .filter((filter) => ids.has(filter.id))
        .flatMap((filter) => filter.tags)
    );
  });
  const allNotifications = createMemo(() =>
    notificationSource
      .notifications()
      .filter((notification) => !notification.deleted_at)
  );
  const soupIds = createMemo(() => {
    const values = {
      channel: [] as string[],
      chat: [] as string[],
      document: [] as string[],
      email: [] as string[],
      foreign: [] as string[],
    };

    for (const notification of allNotifications()) {
      const entityType = String(notification.entity_type);
      if (entityType === 'channel') values.channel.push(notification.entity_id);
      if (entityType === 'chat') values.chat.push(notification.entity_id);
      if (entityType === 'document')
        values.document.push(notification.entity_id);
      if (entityType === 'email') values.email.push(notification.entity_id);
      if (entityType === 'foreign') values.foreign.push(notification.entity_id);
    }

    return values;
  });
  const soupQuery = useSoupItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'viewed_updated' },
      body: {
        ...QUERY_FILTERS_BASE,
        channel_filters: {
          channel_ids: soupIds().channel.length
            ? soupIds().channel
            : QUERY_FILTERS_BASE.channel_filters?.channel_ids,
        },
        chat_filters: {
          chat_ids: soupIds().chat.length
            ? soupIds().chat
            : QUERY_FILTERS_BASE.chat_filters?.chat_ids,
        },
        document_filters: {
          document_ids: soupIds().document.length
            ? soupIds().document
            : QUERY_FILTERS_BASE.document_filters?.document_ids,
        },
        email_filters: {
          email_thread_ids: soupIds().email.length
            ? soupIds().email
            : QUERY_FILTERS_BASE.email_filters?.email_thread_ids,
        },
        foreign_entity_filters: {
          ids: soupIds().foreign.length
            ? soupIds().foreign
            : QUERY_FILTERS_BASE.foreign_entity_filters?.ids,
        },
      },
    }),
    () => ({
      enabled: allNotifications().length > 0,
      showSupportedForeignEntities: true,
    })
  );
  const entityById = createMemo(() => {
    const map = new Map<string, SoupEntityRecord>();

    for (const entity of soupQuery.data ?? []) {
      const record = entity as SoupEntityRecord;
      map.set(`${String(entity.type)}:${entity.id}`, record);
    }

    return map;
  });
  const groups = createMemo(() =>
    buildInboxGroups(
      allNotifications()
        .filter(
          (notification) =>
            !hiddenTags().has(notification.notification_metadata.tag)
        )
        .filter((notification) => {
          if (readFilter() === 'all') return true;
          const unread = !notification.viewed_at && !notification.done;
          return readFilter() === 'unread' ? unread : !unread;
        }),
      entityById()
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
      <SplitHeaderLeft>
        <div class="flex h-full shrink-0 items-center gap-2">
          <AnimatedInboxIcon class="size-4 text-ink-muted" />
          <span class="text-base font-bold">Inbox</span>
        </div>
      </SplitHeaderLeft>
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
