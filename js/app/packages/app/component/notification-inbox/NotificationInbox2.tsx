import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import {
  compileToAst,
  defineQueryFilters,
  type Query,
  queryStateFrom,
} from '@app/component/next-soup/filters/filter-store';
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
import { type EntityData, toNotificationEntity } from '@entity';
import {
  getSortedKeyProperties,
  soupPropertyToProperty,
} from '@entity/extractors-property/property-helpers';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { Popover } from '@kobalte/core/popover';
import {
  type CompositeEntity,
  compositeEntity,
  type UnifiedNotification,
} from '@notifications';
import ArrowSquareOutIcon from '@phosphor-icons/core/regular/arrow-square-out.svg?component-solid';
import SlidersHorizontalIcon from '@phosphor-icons/core/regular/sliders-horizontal.svg?component-solid';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { Button, cn, Dropdown, Layer } from '@ui';
import { startOfDay, subWeeks } from 'date-fns';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import {
  InboxItem,
  type InboxItem as InboxItemData,
  type InboxRelatedDocument,
} from './InboxItem';
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
  getNotificationTime,
} from './notification-utils';
import { NIL_UUID } from '@app/component/next-soup/filters/configs';

type InboxSourceItem = {
  entity: EntityData;
  notification?: UnifiedNotification;
  relatedDocuments?: InboxRelatedDocument[];
  attachments?: InboxItemData['attachments'];
};

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
type InboxMode = 'signal' | 'noise' | 'all';
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
  { id: 'calls', label: 'Calls', tags: ['call_started'] },
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

const subTypeName = (subType: unknown) => {
  if (typeof subType === 'string') return subType.toLowerCase();
  if (subType && typeof subType === 'object' && 'type' in subType) {
    return String((subType as { type: unknown }).type).toLowerCase();
  }
  return undefined;
};

const notificationSubType = (notification: UnifiedNotification) => {
  const content = notification.notification_metadata.content as unknown as {
    subType?: unknown;
  };

  return subTypeName(content.subType);
};

const channelItemAttachments = (
  entity: EntityData | undefined,
  notification: UnifiedNotification
): InboxItemData['attachments'] => {
  if (entity?.type !== 'channel_thread') return undefined;

  const content = notification.notification_metadata.content as
    | { messageId?: string; threadId?: string }
    | undefined;
  const messageId = content?.messageId;

  if (messageId) {
    if (messageId === entity.messageId || messageId === entity.threadId) {
      return entity.attachments;
    }

    const reply = entity.thread.preview.find((reply) => reply.id === messageId);
    if (reply) return reply.attachments;
  }

  if (content?.threadId === entity.threadId) return entity.attachments;

  return entity.attachments;
};

const taskProperties = (entity: EntityData | undefined) => {
  if (entity?.type !== 'document') return undefined;
  if (!('properties' in entity) || !entity.properties?.length) {
    return undefined;
  }

  const properties = entity.properties;

  const keyProperties = getSortedKeyProperties(
    properties.map((property: SoupProperty) => soupPropertyToProperty(property))
  );
  return keyProperties.length ? keyProperties : undefined;
};

const channelDisplayMessage = (entity: EntityData | undefined) => {
  if (entity?.type === 'channel') return entity.latestMessage;
  if (entity?.type === 'channel_message' || entity?.type === 'channel_thread') {
    return {
      content: entity.content,
      senderId: entity.senderId,
      createdAt: entity.createdAt ?? entity.updatedAt,
    };
  }
  return undefined;
};

const transformNotificationItem = (args: {
  id: string;
  notification?: UnifiedNotification;
  entity?: EntityData;
  relatedDocuments?: InboxRelatedDocument[];
  attachments?: InboxItemData['attachments'];
  callStatuses?: string[];
  subItems?: InboxItemData[];
}): InboxItemData => {
  const notification = args.notification;
  const metadata = notification?.notification_metadata;
  const displayMessage = channelDisplayMessage(args.entity);
  const title =
    String(args.entity?.name ?? '') ||
    (notification ? notificationTitle(notification) : '');
  const showSubItems = metadata?.tag !== 'github_pr_status_changed';
  const subType = notification ? notificationSubType(notification) : undefined;

  return {
    id: args.id,
    notification,
    previewEntity: args.entity,
    entityId: notification?.entity_id ?? args.entity?.id,
    entityType: (String(args.entity?.type ?? '') ||
      notification?.entity_type ||
      '') as InboxItemData['entityType'],
    entitySubType:
      args.entity?.type === 'document'
        ? (args.entity.subType?.type ?? subType)
        : subType,
    entityName: title,
    channelType:
      args.entity?.type === 'channel_message' ||
      args.entity?.type === 'channel_thread' ||
      args.entity?.type === 'channel'
        ? args.entity.channelType
        : undefined,
    senderId: displayMessage?.senderId ?? notification?.sender_id ?? undefined,
    senderName:
      displayMessage || !notification
        ? undefined
        : notificationSenderName(notification),
    action: notification ? notificationAction(notification) : undefined,
    targetName: title,
    content:
      displayMessage?.content ??
      (notification ? notificationContent(notification) : undefined) ??
      '',
    properties:
      metadata?.tag === 'task_assigned'
        ? taskProperties(args.entity)
        : undefined,
    relatedDocuments: args.relatedDocuments,
    attachments: args.attachments,
    callStatuses: args.callStatuses,
    timestamp:
      displayMessage?.createdAt != null
        ? String(displayMessage.createdAt)
        : (notification?.created_at ?? notification?.updated_at ?? undefined),
    unread: notification ? !notification.viewed_at && !notification.done : false,
    subItems: showSubItems ? args.subItems : undefined,
  };
};

const getInboxItemTime = (item: InboxItemData): number => {
  if (item.notification) {
    return getNotificationTime(item.notification as UnifiedNotification);
  }
  const time = Date.parse(item.timestamp ?? '');
  return Number.isNaN(time) ? 0 : time;
};

const groupInboxItemsByDate = (items: InboxItemData[]): InboxDateGroup[] => {
  const groups = new Map<string, InboxDateGroup>();

  for (const item of items) {
    const time = getInboxItemTime(item);
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

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: group.items.toSorted(
        (a, b) => getInboxItemTime(b) - getInboxItemTime(a)
      ),
    }))
    .toSorted(
      (a, b) => getInboxItemTime(b.items[0]) - getInboxItemTime(a.items[0])
    );
};

const inboxSourceItemAttachments = (item: InboxSourceItem) =>
  item.attachments ??
  (item.notification
    ? channelItemAttachments(item.entity, item.notification)
    : undefined) ??
  [];

const sourceItemId = (item: InboxSourceItem) =>
  item.notification
    ? `notification:${item.notification.id}`
    : `entity:${String(item.entity.type)}:${item.entity.id}`;

// Items that share a group key collapse together; everything else stays on its
// own. Threads (channel threads and email threads) group per thread; top-level
// channel messages without a thread join into a single per-channel item.
const getInboxGroupKey = (entity: EntityData): string | undefined => {
  if (entity.type === 'channel') return `channel:${entity.id}`;
  if (entity.type === 'channel_message') {
    return entity.threadId
      ? `channel:${entity.channelId}:thread:${entity.threadId}`
      : `channel:${entity.channelId}`;
  }
  if (entity.type === 'channel_thread') {
    return `channel:${entity.channelId}:thread:${entity.threadId}`;
  }
  if (entity.type === 'email') return `email:${entity.id}`;
  return undefined;
};

const sourceItemTime = (item: InboxSourceItem): number => {
  const message = channelDisplayMessage(item.entity);
  const raw =
    message?.createdAt ??
    item.notification?.created_at ??
    item.notification?.updated_at;
  const time = raw != null ? Date.parse(String(raw)) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
};

// Threads (channel threads and email threads) group no matter where they fall
// in the list, so they're clustered together up front. Root channel items and
// keyless items keep their original order and only group when consecutive.
const isClusterableGroupKey = (key: string | undefined) =>
  key !== undefined && (key.includes(':thread:') || key.startsWith('email:'));

const orderForGrouping = (items: InboxSourceItem[]): InboxSourceItem[] =>
  items.toSorted((a, b) => {
    const keyA = getInboxGroupKey(a.entity);
    const keyB = getInboxGroupKey(b.entity);
    const clusterA = isClusterableGroupKey(keyA);
    const clusterB = isClusterableGroupKey(keyB);
    if (!clusterA || !clusterB) {
      if (clusterA) return -1;
      if (clusterB) return 1;
      return 0; // both stay in their original order
    }
    if (keyA !== keyB) return keyA! < keyB! ? -1 : 1;
    return sourceItemTime(b) - sourceItemTime(a);
  });

// Merges runs of adjacent items that share a group key. Only consecutive items
// group, so the upstream ordering decides what ends up together.
const groupConsecutiveSourceItems = (
  items: InboxSourceItem[]
): InboxSourceItem[][] => {
  const groups: InboxSourceItem[][] = [];
  let currentKey: string | undefined;

  for (const item of items) {
    const key = getInboxGroupKey(item.entity);
    const current = groups.at(-1);

    if (key !== undefined && key === currentKey && current) {
      current.push(item);
      continue;
    }

    currentKey = key;
    groups.push([item]);
  }

  return groups;
};

const buildInboxItem = (group: InboxSourceItem[]): InboxItemData => {
  const root = group[0];
  const grouped = group.length > 1;

  return transformNotificationItem({
    id: grouped ? `group:${sourceItemId(root)}` : sourceItemId(root),
    notification: root.notification,
    entity: root.entity,
    attachments: inboxSourceItemAttachments(root),
    relatedDocuments: group.flatMap((item) => item.relatedDocuments ?? []),
    callStatuses:
      root.entity.type === 'call' ? [root.entity.status] : undefined,
    subItems: grouped
      ? group.map((item) =>
          transformNotificationItem({
            id: sourceItemId(item),
            notification: item.notification,
            entity: item.entity,
            attachments: inboxSourceItemAttachments(item),
          })
        )
      : undefined,
  });
};

const buildInboxItems = (items: InboxSourceItem[]): InboxItemData[] =>
  groupConsecutiveSourceItems(orderForGrouping(items)).map(buildInboxItem);

const buildInboxGroups = (items: InboxSourceItem[]): InboxDateGroup[] =>
  groupInboxItemsByDate(buildInboxItems(items));

const readFilterSeen = (readFilter: ReadFilter) => {
  if (readFilter === 'all') return undefined;
  return readFilter === 'read';
};

const inboxQueryFilters = (mode: InboxMode, readFilter: ReadFilter): Query => {
  const seen = readFilterSeen(readFilter);
  const seenFilter =
    seen === undefined
      ? {}
      : {
          channelId: [NIL_UUID],
          documentSeen: seen,
          emailSeen: seen,
          channelSeen: seen,
          chatSeen: seen,
          folderSeen: seen,
        };

  if (mode === 'all') {
    return defineQueryFilters({
      include: {
        documentId: [],
        threadId: [],
        channelId: [NIL_UUID],
        channelThreadId: [],
        chatId: [],
        callId: [],
        foreignEntityRecordId: [],
        ...seenFilter,
      },
      emailView: 'all',
    });
  }

  if (mode === 'noise') {
    return defineQueryFilters({
      include: {
        documentDone: false,
        emailDone: false,
        emailImportance: false,
        channelDone: false,
        channelThreadId: [],
        chatDone: false,
        callId: [],
        folderDone: false,
        emailShared: 'exclude',
        ...seenFilter,
      },
      emailView: 'inbox',
    });
  }

  const twoWeeksAgo = subWeeks(startOfDay(new Date()), 2).toISOString();
  return defineQueryFilters({
    include: {
      documentDone: false,
      documentUpdatedAt: { gte: twoWeeksAgo },
      emailDone: false,
      emailImportance: true,
      emailUpdatedAt: { gte: twoWeeksAgo },
      channelDone: false,
      channelId: [NIL_UUID],
      channelThreadId: [],
      chatDone: false,
      chatUpdatedAt: { gte: twoWeeksAgo },
      callId: [],
      folderDone: false,
      folderUpdatedAt: { gte: twoWeeksAgo },
      emailShared: 'exclude',
      ...seenFilter,
    },
    emailView: 'inbox',
  });
};

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

  if (metadata.tag === 'channel_message_reply' && metadata.content.threadId) {
    const threadId = metadata.content.threadId;
    return {
      id: threadId,
      type: 'channel_thread',
      name: metadata.content.channelName ?? 'Channel',
      ownerId: '',
      createdAt: date,
      updatedAt: date,
      channelId: notification.entity_id,
      channelName: metadata.content.channelName ?? 'Channel',
      channelType:
        channelType === 'direct_message' ? 'direct_message' : channelType,
      messageId: threadId,
      threadId,
      senderId: senderId ?? '',
      sender: {
        id: senderId ?? '',
        type: 'user',
      },
      content: metadata.content.messageContent ?? '',
      attachments: [],
      reactions: [],
      thread: {
        replyCount: 0,
        preview: [],
      },
    } as EntityData;
  }

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
  if (item.previewEntity) return item.previewEntity;

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
    case 'commented_on_document': {
      const subType = metadata.content.subType?.type;

      return {
        id: notification.entity_id,
        type: 'document',
        name: metadata.content.documentName ?? 'Document',
        ownerId: '',
        createdAt: date,
        updatedAt: date,
        viewedAt: notification.viewed_at ?? null,
        fileType: metadata.content.fileType ?? 'md',
        subType:
          subType === 'task'
            ? { type: 'task' }
            : subType === 'snippet'
              ? { type: 'snippet' }
              : null,
      } as EntityData;
    }
    case 'ai_response':
      return {
        id: notification.entity_id,
        type: 'chat',
        name: item.entityName || metadata.content.summary || 'AI response',
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
        ...(item.entityType === 'document' && item.entitySubType === 'task'
          ? { fileType: 'md', subType: { type: 'task' as const } }
          : {}),
      } as EntityData;
  }
}

function NotificationInboxList(props: {
  groups: InboxDateGroup[];
  hiddenFilterIds: string[];
  readFilter: ReadFilter;
  inboxMode: InboxMode;
  selectedItem: InboxItemData | undefined;
  onReadFilterChange: (filter: ReadFilter) => void;
  onInboxModeChange: (mode: InboxMode) => void;
  onLoadMore: () => void;
  onSelect: (item: InboxItemData) => void;
  onToggleFilter: (filterId: string) => void;
}) {
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [showDevFilters, setShowDevFilters] = createSignal(false);

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
      ...group.items.flatMap((item) => {
        return [
          { type: 'item' as const, id: item.id, item, depth: 0 },
          ...(isExpanded(item)
            ? (item.subItems ?? []).map((subItem) => ({
                type: 'item' as const,
                id: subItem.id,
                item: subItem,
                depth: 1,
              }))
            : []),
        ];
      }),
    ])
  );

  const [scrollOffset, setScrollOffset] = createSignal(0);
  const maybeLoadMore = () => {
    const handle = virtualHandle();
    if (!handle) return;
    const distanceFromEnd =
      handle.scrollSize - handle.viewportSize - handle.scrollOffset;
    if (distanceFromEnd > 600) return;
    props.onLoadMore();
  };

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

  const selectItem = (item: InboxItemData) => {
    props.onSelect(item);
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
    <>
      <SplitHeaderLeft>
        <div class="flex h-full shrink-0 items-center gap-2">
          <AnimatedInboxIcon class="size-4 text-ink-muted" />
          <span class="text-base font-bold">Inbox</span>
          <Popover
            gutter={4}
            open={settingsOpen()}
            placement="bottom-start"
            onOpenChange={setSettingsOpen}
          >
            <Popover.Trigger
              as={Button}
              class="h-7 bg-surface text-ink-muted"
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
                  variant={showDevFilters() ? 'active' : 'base'}
                  onClick={() => setShowDevFilters((value) => !value)}
                >
                  Dev filters
                </Button>
                <Show when={showDevFilters()}>
                  <div class="flex flex-col gap-2 rounded-md border border-dashed border-edge-muted bg-ink-muted/2.5 p-1">
                    <div class="flex flex-wrap gap-1">
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
                  </div>
                </Show>
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        </div>
      </SplitHeaderLeft>
      <div
        ref={attachHotkeys}
        class="flex size-full min-h-0 flex-col bg-surface p-2 outline-none"
        tabIndex={0}
      >
        <div class="mb-2 flex shrink-0 items-center gap-2">
          <Dropdown placement="bottom-start" gutter={4}>
            <Dropdown.Trigger
              class="h-7 bg-surface text-ink-muted capitalize"
              depth={2}
              size="sm"
              variant="base"
            >
              {props.inboxMode}
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.Group>
                <For each={['signal', 'noise', 'all'] as const}>
                  {(mode) => (
                    <Dropdown.Item
                      class="cursor-default px-2.5 py-1.5 text-sm capitalize text-ink-muted outline-none hover:bg-hover"
                      onSelect={() => props.onInboxModeChange(mode)}
                    >
                      {mode}
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
          <TabsInset
            class="ml-auto h-auto w-fit"
            list={[
              { value: 'unread', label: 'Unread' },
              { value: 'read', label: 'Read' },
              { value: 'all', label: 'All' },
            ]}
            value={props.readFilter}
            onChange={(value) => props.onReadFilterChange(value as ReadFilter)}
          />
        </div>
        <div class="flex min-h-0 flex-1 flex-col">
          <Show when={currentHeader()}>
            {(label) => (
              <Layer depth={2}>
                <div class="my-2 flex items-center px-2">
                  <h1 class="text-sm font-medium text-ink/75">{label()}</h1>
                </div>
              </Layer>
            )}
          </Show>
          <VList
            ref={setVirtualHandle}
            data={rows()}
            class="min-h-0 flex-1 scrollbar-hidden"
            style={{ height: '100%', width: '100%' }}
            onScroll={(offset) => {
              setScrollOffset(offset);
              maybeLoadMore();
            }}
          >
            {(row) => {
              if (row.type === 'header') {
                return (
                  <Layer depth={2}>
                    <div
                      class={cn(
                        'my-2 flex items-center px-2',
                        row.label === currentHeader() &&
                          'invisible h-px overflow-hidden pointer-events-none'
                      )}
                    >
                      <h1 class="text-sm font-medium text-ink/75">
                        {row.label}
                      </h1>
                    </div>
                  </Layer>
                );
              }

              const onItemClick = () => {
                selectItem(row.item);
              };
              const onSelectRelatedDocument = (
                document: InboxRelatedDocument
              ) => {
                props.onSelect({
                  id: `related-document:${document.id}`,
                  previewEntity: {
                    id: document.id,
                    type: 'document',
                    name: document.name,
                    ownerId: '',
                    fileType: document.fileType ?? 'md',
                    subType:
                      document.subType === 'task'
                        ? { type: 'task' as const }
                        : document.subType === 'snippet'
                          ? { type: 'snippet' as const }
                          : undefined,
                  } as EntityData,
                  entityId: document.id,
                  entityType: 'document',
                  entitySubType: document.subType,
                  entityName: document.name,
                });
              };
              return (
                <div
                  class={cn(
                    row.depth > 0 && 'ml-2 border-l border-edge-muted pl-4'
                  )}
                >
                  <InboxItem.Root
                    expanded={isExpanded(row.item)}
                    highlighted={focusedRow()?.item.id === row.item.id}
                    item={row.item}
                    selected={props.selectedItem?.id === row.item.id}
                  >
                    <InboxItemLayout
                      expanded={isExpanded(row.item)}
                      highlighted={focusedRow()?.item.id === row.item.id}
                      item={row.item}
                      nested={row.depth > 0}
                      selected={props.selectedItem?.id === row.item.id}
                      unread={Boolean(
                        row.item.unread ||
                          row.item.subItems?.some((subItem) => subItem.unread)
                      )}
                      onClick={onItemClick}
                      onSelectRelatedDocument={onSelectRelatedDocument}
                      onToggleExpanded={() =>
                        setExpanded(row.item, !isExpanded(row.item))
                      }
                    />
                  </InboxItem.Root>
                </div>
              );
            }}
          </VList>
        </div>
      </div>
    </>
  );
}

export function NotificationInbox2() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const notificationSource = useGlobalNotificationSource();
  const [hiddenFilterIds, setHiddenFilterIds] = createSignal<string[]>([]);
  const [readFilter, setReadFilter] = createSignal<ReadFilter>('unread');
  const [inboxMode, setInboxMode] = createSignal<InboxMode>('signal');
  const hiddenTags = createMemo(() => {
    const ids = new Set(hiddenFilterIds());
    return new Set(
      devNotificationFilters
        .filter((filter) => ids.has(filter.id))
        .flatMap((filter) => filter.tags)
    );
  });
  const activeSoupQuery = createMemo(() =>
    inboxQueryFilters(inboxMode(), readFilter())
  );
  const soupQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'viewed_updated' },
      body: compileToAst(queryStateFrom(activeSoupQuery())),
    }),
    () => ({
      enabled: true,
      showSupportedForeignEntities: true,
    })
  );
  const queryItems = createMemo(() => {
    const entities = soupQuery.data?.entities;
    if (!entities) return [];

    const seen = new Set<string>();
    const items: InboxSourceItem[] = [];
    const notificationsByEntity = notificationSource.notificationsByEntity();
    const channelThreadsById = new Map(
      entities
        .filter((entity) => entity.type === 'channel_thread')
        .map((entity) => [entity.threadId, entity])
    );
    const channelThreadsByReplyId = new Map(
      entities
        .filter((entity) => entity.type === 'channel_thread')
        .flatMap((entity) =>
          entity.thread.preview.map((reply) => [reply.id, entity] as const)
        )
    );
    const notificationAttachments = (
      entity: EntityData,
      notification: UnifiedNotification
    ): InboxItemData['attachments'] => {
      const direct = channelItemAttachments(entity, notification);
      if (direct?.length) return direct;

      const content = notification.notification_metadata.content as
        | { threadId?: string; messageId?: string }
        | undefined;
      const thread =
        (content?.threadId
          ? channelThreadsById.get(content.threadId)
          : undefined) ??
        (content?.messageId
          ? (channelThreadsById.get(content.messageId) ??
            channelThreadsByReplyId.get(content.messageId))
          : undefined);

      return thread ? channelItemAttachments(thread, notification) : undefined;
    };

    for (const entity of entities) {
      const keys = new Set([
        compositeEntity(toNotificationEntity(entity)),
        `${String(entity.type)}@${entity.id}` as CompositeEntity,
      ]);
      if (entity.type === 'call') {
        keys.add(compositeEntity({ type: 'channel', id: entity.channelId }));
      }
      const entityNotifications: UnifiedNotification[] = [];

      for (const key of keys) {
        entityNotifications.push(...(notificationsByEntity[key] ?? []));
      }

      const matchingNotifications = entityNotifications.filter(
        (notification) => {
          const tag = String(notification.notification_metadata.tag);

          if (tag === 'call_started' || tag === 'call-started') {
            return entity.type === 'call';
          }

          if (entity.type === 'call') return false;

          if (entity.type === 'channel_message') {
            const content = notification.notification_metadata.content as
              | { messageId?: string }
              | undefined;
            return content?.messageId === entity.messageId;
          }

          if (entity.type === 'channel_thread') {
            const content = notification.notification_metadata.content as
              | { threadId?: string; messageId?: string }
              | undefined;
            return (
              content?.threadId === entity.threadId ||
              content?.messageId === entity.messageId
            );
          }

          return true;
        }
      );

      for (const notification of matchingNotifications) {
        const seenKey =
          entity.type === 'channel_thread'
            ? `channel_thread:${entity.id}:${notification.id}`
            : notification.id;
        if (notification.deleted_at || seen.has(seenKey)) continue;
        seen.add(seenKey);
        items.push({
          entity,
          notification,
          attachments: notificationAttachments(entity, notification),
        });
      }

      // Entities without a notification of their own (e.g. the current user's
      // own messages) still belong in the inbox — don't filter them out.
      if (matchingNotifications.length === 0) {
        const seenKey = `entity:${String(entity.type)}:${entity.id}`;
        if (!seen.has(seenKey)) {
          seen.add(seenKey);
          items.push({ entity });
        }
      }
    }

    return items;
  });
  const groups = createMemo(() => buildInboxGroups(queryItems()));
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
  const [selectedGroupItem, setSelectedGroupItem] = createSignal<
    InboxItemData | undefined
  >();
  const getItemTimestamp = (item: InboxItemData) => {
    const timestamp = Date.parse(item.timestamp ?? '');
    return Number.isNaN(timestamp) ? 0 : timestamp;
  };
  const mostRecentUnreadSubItem = (item: InboxItemData) =>
    item.subItems
      ?.filter((subItem) => subItem.unread)
      .toSorted((a, b) => getItemTimestamp(b) - getItemTimestamp(a))
      .at(0);
  const selectedEntity = () => {
    const item = selectedItem();
    if (!item) return undefined;
    return previewEntity(item);
  };

  const listSelectedItem = () => selectedGroupItem() ?? selectedItem();

  const handleListSelect = (item: InboxItemData) => {
    if (item.subItems?.length) {
      setSelectedGroupItem(item);
      setSelectedItem(mostRecentUnreadSubItem(item) ?? item.subItems[0]);
      return;
    }

    setSelectedGroupItem(undefined);
    setSelectedItem(item);
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
          index={0}
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
              inboxMode={inboxMode()}
              readFilter={readFilter()}
              onInboxModeChange={setInboxMode}
              onLoadMore={() => {
                if (!soupQuery.hasNextPage || soupQuery.isFetchingNextPage) {
                  return;
                }
                void soupQuery.fetchNextPage();
              }}
              onReadFilterChange={setReadFilter}
              onSelect={handleListSelect}
              onToggleFilter={toggleFilter}
              selectedItem={listSelectedItem()}
            />
          </div>
        </Resize.Panel>
        <Resize.Panel
          id="notification-inbox-preview"
          index={2}
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
