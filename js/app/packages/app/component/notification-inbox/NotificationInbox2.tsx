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
import { InboxItemActionLocationLayout } from './layouts/InboxItemActionLocationLayout';
import { InboxItemInlineTypeLayout } from './layouts/InboxItemInlineTypeLayout';
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
} from './notification-utils';

type InboxSourceItem = {
  entity: EntityData;
  notification: UnifiedNotification;
  relatedDocuments?: InboxRelatedDocument[];
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
type InboxLayoutMode = 'inline' | 'action-location';

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

const transformNotificationItem = (args: {
  id: string;
  notification: UnifiedNotification;
  entity?: EntityData;
  relatedDocuments?: InboxRelatedDocument[];
  callStatuses?: string[];
  subItems?: InboxItemData[];
}): InboxItemData => {
  const metadata = args.notification.notification_metadata;
  const notificationTitleValue = notificationTitle(args.notification);
  const title = metadata.tag.startsWith('channel_')
    ? String(args.entity?.name ?? '') || notificationTitleValue
    : String(args.entity?.name ?? '') || notificationTitleValue;
  const showSubItems = metadata.tag !== 'github_pr_status_changed';

  return {
    id: args.id,
    notification: args.notification,
    previewEntity: args.entity,
    entityId: args.notification.entity_id,
    entityType: (String(args.entity?.type ?? '') ||
      args.notification.entity_type) as InboxItemData['entityType'],
    entitySubType:
      args.entity?.type === 'document'
        ? (args.entity.subType?.type ?? notificationSubType(args.notification))
        : notificationSubType(args.notification),
    entityName: title,
    channelType:
      args.entity?.type === 'channel_message' || args.entity?.type === 'channel'
        ? args.entity.channelType
        : undefined,
    senderId: args.notification.sender_id ?? undefined,
    senderName: notificationSenderName(args.notification),
    action: notificationAction(args.notification),
    targetName: title,
    content:
      notificationContent(args.notification) ||
      (args.entity?.type === 'channel_message' ? args.entity.content : ''),
    properties:
      metadata.tag === 'task_assigned'
        ? taskProperties(args.entity)
        : undefined,
    relatedDocuments: args.relatedDocuments,
    callStatuses: args.callStatuses,
    timestamp: args.notification.created_at ?? args.notification.updated_at,
    unread: !args.notification.viewed_at && !args.notification.done,
    subItems: showSubItems ? args.subItems : undefined,
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
    const threadId = content.threadId ? String(content.threadId) : undefined;
    if (threadId) return `channel-thread:${notification.entity_id}:${threadId}`;
    return `channel-root:${notification.entity_id}`;
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

const getInboxSourceItemGroupKey = (item: InboxSourceItem) => {
  if (item.entity.type === 'call') {
    if (item.entity.isActive) return undefined;
    return `call:${item.entity.channelId}`;
  }

  return getInboxItemGroupKey(item.notification);
};

const buildInboxItems = (items: InboxSourceItem[]): InboxItemData[] => {
  const groups: InboxSourceItem[][] = [];
  const rootChannelGroups = new Map<string, InboxSourceItem[]>();
  let currentKey: string | undefined;

  for (const item of items) {
    const key = getInboxSourceItemGroupKey(item);

    if (key?.startsWith('channel-root:')) {
      const existing = rootChannelGroups.get(key);
      if (existing) {
        existing.push(item);
        currentKey = undefined;
        continue;
      }

      const group = [item];
      rootChannelGroups.set(key, group);
      groups.push(group);
      currentKey = undefined;
      continue;
    }

    const current = groups.at(-1);

    if (key && key === currentKey && current) {
      current.push(item);
      continue;
    }

    currentKey = key;
    groups.push([item]);
  }

  return groups.map((group) => {
    const root = group[0];
    const groupKey = getInboxSourceItemGroupKey(root);
    const groupDateKey = getDateGroupKey(
      getNotificationTime(root.notification)
    );

    return transformNotificationItem({
      id:
        group.length > 1
          ? `${groupDateKey}:${groupKey ?? `notification:${root.notification.id}`}`
          : `notification:${root.notification.id}`,
      notification: root.notification,
      entity: root.entity,
      relatedDocuments: group.flatMap((item) => item.relatedDocuments ?? []),
      callStatuses:
        root.entity.type === 'call'
          ? group.flatMap((item) =>
              item.entity.type === 'call' ? [item.entity.status] : []
            )
          : undefined,
      subItems:
        group.length > 1
          ? group.map((item) =>
              transformNotificationItem({
                id: `notification:${item.notification.id}`,
                notification: item.notification,
                entity: item.entity,
              })
            )
          : undefined,
    });
  });
};

const isChannelBackedDocumentMention = (item: InboxSourceItem) => {
  const metadata = item.notification.notification_metadata;
  return (
    metadata.tag === 'document_mention' && Boolean(metadata.content.messageId)
  );
};

const isChannelInboxItem = (item: InboxSourceItem) =>
  isChannelNotification(item.notification);

const documentMentionRelatedDocument = (
  item: InboxSourceItem
): InboxRelatedDocument | undefined => {
  const metadata = item.notification.notification_metadata;
  if (metadata.tag !== 'document_mention') return undefined;

  return {
    id: item.notification.entity_id,
    name: metadata.content.documentName,
    fileType: metadata.content.fileType ?? 'md',
    senderName: notificationSenderName(item.notification),
    subType: subTypeName(metadata.content.subType),
  };
};

const attachChannelDocumentMentions = (items: InboxSourceItem[]) => {
  const filtered: InboxSourceItem[] = [];

  for (const item of items) {
    const previous = filtered.at(-1);
    const relatedDocument = documentMentionRelatedDocument(item);
    if (
      previous &&
      relatedDocument &&
      isChannelInboxItem(previous) &&
      isChannelBackedDocumentMention(item)
    ) {
      previous.relatedDocuments = [
        ...(previous.relatedDocuments ?? []),
        relatedDocument,
      ];
      continue;
    }

    filtered.push(item);
  }

  return filtered;
};

const buildInboxGroups = (items: InboxSourceItem[]): InboxDateGroup[] =>
  groupInboxItemsByDate(buildInboxItems(attachChannelDocumentMentions(items)));

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
        channelId: [],
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

function NotificationInboxGroupItemsPanel(props: {
  groupItem: InboxItemData;
  selectedItem: InboxItemData | undefined;
  onSelect: (item: InboxItemData) => void;
}) {
  return (
    <div class="flex size-full min-h-0 flex-col bg-surface p-2">
      <div class="mb-2 flex shrink-0 flex-col gap-0.5 px-2 py-1">
        <h2 class="truncate text-sm font-medium text-ink">
          {props.groupItem.entityName || props.groupItem.targetName || 'Group'}
        </h2>
        <span class="text-xs text-ink-extra-muted">
          {props.groupItem.subItems?.length ?? 0} notifications
        </span>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto scrollbar-hidden">
        <For each={props.groupItem.subItems ?? []}>
          {(item) => (
            <div class="pb-1">
              <InboxItem.Root
                item={item}
                selected={props.selectedItem?.id === item.id}
              >
                <InboxItemActionLocationLayout
                  nested
                  onClick={() => props.onSelect(item)}
                />
              </InboxItem.Root>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function NotificationInboxList(props: {
  groups: InboxDateGroup[];
  hiddenFilterIds: string[];
  readFilter: ReadFilter;
  inboxMode: InboxMode;
  layoutMode: InboxLayoutMode;
  selectedItem: InboxItemData | undefined;
  onReadFilterChange: (filter: ReadFilter) => void;
  onInboxModeChange: (mode: InboxMode) => void;
  onLayoutModeChange: (mode: InboxLayoutMode) => void;
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
                    <div class="flex items-center gap-2">
                      <span class="shrink-0 px-1 text-xs font-medium text-ink-extra-muted">
                        Layout
                      </span>
                      <Dropdown placement="bottom-start" gutter={4}>
                        <Dropdown.Trigger
                          class="h-7 bg-surface text-ink-muted capitalize"
                          depth={2}
                          size="sm"
                          variant="base"
                        >
                          {props.layoutMode === 'inline' ? 'Inline' : 'Action'}
                        </Dropdown.Trigger>
                        <Dropdown.Content>
                          <Dropdown.Group>
                            <For each={['inline', 'action-location'] as const}>
                              {(mode) => (
                                <Dropdown.Item
                                  class="cursor-default px-2.5 py-1.5 text-sm capitalize text-ink-muted outline-none hover:bg-hover"
                                  onSelect={() =>
                                    props.onLayoutModeChange(mode)
                                  }
                                >
                                  {mode === 'inline'
                                    ? 'Inline'
                                    : 'Action/location'}
                                </Dropdown.Item>
                              )}
                            </For>
                          </Dropdown.Group>
                        </Dropdown.Content>
                      </Dropdown>
                    </div>
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
                    row.depth > 0 &&
                      (props.layoutMode === 'action-location'
                        ? 'ml-8 pl-2'
                        : 'ml-2 border-l border-edge-muted pl-4')
                  )}
                >
                  <InboxItem.Root
                    expanded={isExpanded(row.item)}
                    highlighted={focusedRow()?.item.id === row.item.id}
                    item={row.item}
                    selected={props.selectedItem?.id === row.item.id}
                  >
                    <Show
                      when={props.layoutMode === 'action-location'}
                      fallback={
                        <InboxItemInlineTypeLayout
                          onClick={onItemClick}
                          onSelectRelatedDocument={onSelectRelatedDocument}
                          onToggleExpanded={() =>
                            setExpanded(row.item, !isExpanded(row.item))
                          }
                        />
                      }
                    >
                      <InboxItemActionLocationLayout
                        nested={row.depth > 0}
                        onClick={onItemClick}
                        onSelectRelatedDocument={onSelectRelatedDocument}
                        onToggleExpanded={() =>
                          setExpanded(row.item, !isExpanded(row.item))
                        }
                      />
                    </Show>
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
  const [layoutMode, setLayoutMode] = createSignal<InboxLayoutMode>('inline');
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

          return true;
        }
      );

      for (const notification of matchingNotifications) {
        if (notification.deleted_at || seen.has(notification.id)) continue;
        seen.add(notification.id);
        items.push({ entity, notification });
      }
    }

    return items;
  });
  const groups = createMemo(() =>
    buildInboxGroups(
      queryItems().filter(
        (item) => !hiddenTags().has(item.notification.notification_metadata.tag)
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
  const [selectedGroupItem, setSelectedGroupItem] = createSignal<
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
  const listSelectedItem = () => selectedGroupItem() ?? selectedItem();
  const handleListSelect = (item: InboxItemData) => {
    if (item.subItems?.length) {
      setSelectedGroupItem(item);
      setSelectedItem(undefined);
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
              layoutMode={layoutMode()}
              readFilter={readFilter()}
              onInboxModeChange={setInboxMode}
              onLayoutModeChange={setLayoutMode}
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
        <Show when={selectedGroupItem()}>
          {(groupItem) => (
            <Resize.Panel
              id="notification-inbox-group-items"
              index={1}
              minSize={240}
              target={{ kind: 'px', px: 320 }}
            >
              <div class="size-full min-h-0 min-w-0 border-r border-edge-muted">
                <NotificationInboxGroupItemsPanel
                  groupItem={groupItem()}
                  selectedItem={selectedItem()}
                  onSelect={setSelectedItem}
                />
              </div>
            </Resize.Panel>
          )}
        </Show>
        <Resize.Panel
          id="notification-inbox-preview"
          index={2}
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
