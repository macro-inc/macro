import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import type { UnifiedNotification } from '@notifications';
import FunnelIcon from '@phosphor/funnel.svg';
import SortAscendingIcon from '@phosphor/sort-ascending.svg';
import StackIcon from '@phosphor/stack.svg';
import CaretDownIcon from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import type { GithubPrEventStatus } from '@service-notification/generated/schemas';
import { Button, cn } from '@ui';
import { createEffect, createSignal, For, Match, Show, Switch } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import {
  GithubNotificationListEntity,
  NotificationListEntity,
} from './NotificationListEntity';

type NotificationListLayout = 'compact' | 'multirow';

type GithubNotificationGroup = {
  id: string;
  title: string;
  subtitle: string;
  status?: GithubPrEventStatus;
  url?: string;
  authorId?: string;
  authorFallback?: string;
  notifications: UnifiedNotification[];
  subItems: UnifiedNotification[];
};

type ChannelNotificationGroup = {
  id: string;
  notifications: UnifiedNotification[];
  subItems: UnifiedNotification[];
};

type NotificationInboxItem =
  | { id: string; type: 'notification'; notification: UnifiedNotification }
  | { id: string; type: 'github'; group: GithubNotificationGroup }
  | { id: string; type: 'channel'; group: ChannelNotificationGroup };

type NotificationDateGroup = {
  id: string;
  label: string;
  items: NotificationInboxItem[];
};

type ChannelNotificationStack = {
  id: string;
  notifications: UnifiedNotification[];
};

const getNotificationTime = (notification: UnifiedNotification): number => {
  const time = Date.parse(
    notification.created_at ?? notification.updated_at ?? ''
  );
  return Number.isNaN(time) ? 0 : time;
};

const sortNotifications = (
  notifications: UnifiedNotification[]
): UnifiedNotification[] =>
  notifications.toSorted(
    (a, b) => getNotificationTime(b) - getNotificationTime(a)
  );

const getDateGroupKey = (time: number): string => {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const getDateGroupLabel = (time: number): string => {
  const date = new Date(time);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date);
};

const isGithubStatusNotification = (
  notification: UnifiedNotification
): boolean => {
  const metadata = notification.notification_metadata;
  if (metadata.tag !== 'github_pr_event') return false;

  return (
    metadata.content.action === 'opened' ||
    metadata.content.action === 'reopened' ||
    metadata.content.action === 'closed' ||
    (!!metadata.content.previousStatus &&
      metadata.content.previousStatus !== metadata.content.status)
  );
};

const getGithubGroupKey = (notification: UnifiedNotification): string => {
  const metadata = notification.notification_metadata;
  if (metadata.tag !== 'github_pr_event') return notification.id;
  return metadata.content.foreignEntityId || metadata.content.githubKey;
};

const getChannelThreadId = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_message_reply':
      return metadata.content.threadId;
    case 'channel_mention':
      return metadata.content.threadId ?? undefined;
    default:
      return undefined;
  }
};

const getChannelMessageId = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_message_send':
    case 'channel_message_reply':
    case 'channel_mention':
      return metadata.content.messageId;
    default:
      return undefined;
  }
};

const isChannelInboxNotification = (
  notification: UnifiedNotification
): boolean => getChannelMessageId(notification) !== undefined;

const isChannelMessageSend = (notification: UnifiedNotification): boolean =>
  notification.notification_metadata.tag === 'channel_message_send';

const getConsecutiveChannelSendStackKey = (
  notification: UnifiedNotification
): string => `${notification.entity_id}:${getChannelSenderKey(notification)}`;

const getChannelSenderKey = (notification: UnifiedNotification): string => {
  if (notification.sender_id) return notification.sender_id;

  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_message_send':
      return metadata.content.sender;
    case 'channel_message_reply':
      return metadata.content.userId;
    default:
      return notification.id;
  }
};

const getChannelSenderLabel = (notification: UnifiedNotification): string => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_message_send':
      return metadata.content.sender;
    case 'channel_message_reply':
      return metadata.content.userId;
    default:
      return notification.sender_id ?? 'Unknown';
  }
};

const getChannelStackSenderKeys = (
  stack: ChannelNotificationStack
): string[] => [...new Set(stack.notifications.map(getChannelSenderKey))];

const getChannelName = (notification: UnifiedNotification): string => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_message_send':
    case 'channel_message_reply':
    case 'channel_mention':
      return metadata.content.channelName ?? 'Channel';
    default:
      return 'Channel';
  }
};

const getChannelType = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;
  return metadata.tag === 'channel_message_send' ||
    metadata.tag === 'channel_message_reply' ||
    metadata.tag === 'channel_mention'
    ? metadata.content.channelType
    : undefined;
};

const isDirectMessageNotification = (
  notification: UnifiedNotification
): boolean => getChannelType(notification) === 'directMessage';

const getChannelIconType = (
  notification: UnifiedNotification
): EntityIconSelector => {
  const channelType = getChannelType(notification);

  return channelType === 'directMessage'
    ? 'direct_message'
    : ((channelType ?? 'channel') as EntityIconSelector);
};

const getChannelStackUnreadCount = (stack: ChannelNotificationStack): number =>
  stack.notifications.filter(
    (notification) => !notification.viewed_at && !notification.done
  ).length;

const stackConsecutiveChannelNotifications = (
  notifications: UnifiedNotification[]
): ChannelNotificationStack[] => {
  const stacks: ChannelNotificationStack[] = [];

  for (const notification of notifications) {
    const previous = stacks.at(-1);
    const previousNotification = previous?.notifications.at(-1);

    if (
      previousNotification &&
      getChannelSenderKey(previousNotification) ===
        getChannelSenderKey(notification)
    ) {
      previous?.notifications.push(notification);
      continue;
    }

    stacks.push({
      id: notification.id,
      notifications: [notification],
    });
  }

  return stacks;
};

const createChannelThreadGroups = (
  notifications: UnifiedNotification[]
): Map<string, UnifiedNotification[]> => {
  const parents = new Map<string, string>();
  const getNode = (notification: UnifiedNotification, id: string): string =>
    `${notification.entity_id}:${id}`;

  const find = (node: string): string => {
    const parent = parents.get(node);
    if (!parent || parent === node) {
      parents.set(node, node);
      return node;
    }

    const root = find(parent);
    parents.set(node, root);
    return root;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parents.set(rootB, rootA);
  };

  for (const notification of notifications) {
    const messageId = getChannelMessageId(notification);
    const threadId = getChannelThreadId(notification);

    if (messageId) find(getNode(notification, messageId));
    if (threadId) find(getNode(notification, threadId));
    if (messageId && threadId) {
      union(getNode(notification, threadId), getNode(notification, messageId));
    }
  }

  const groups = new Map<string, UnifiedNotification[]>();

  for (const notification of notifications) {
    const messageId = getChannelMessageId(notification);
    const threadId = getChannelThreadId(notification);
    const root = find(
      getNode(notification, threadId ?? messageId ?? notification.id)
    );

    groups.set(root, [...(groups.get(root) ?? []), notification]);
  }

  return groups;
};

const getItemPrimaryNotification = (
  item: NotificationInboxItem
): UnifiedNotification =>
  item.type === 'notification'
    ? item.notification
    : item.group.notifications[0];

const getItemTime = (item: NotificationInboxItem): number =>
  getNotificationTime(getItemPrimaryNotification(item));

const sortItems = (items: NotificationInboxItem[]): NotificationInboxItem[] =>
  items.toSorted((a, b) => getItemTime(b) - getItemTime(a));

const groupItemsByDate = (
  items: NotificationInboxItem[]
): NotificationDateGroup[] => {
  const groups = new Map<string, NotificationDateGroup>();

  for (const item of items) {
    const time = getNotificationTime(getItemPrimaryNotification(item));
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
      items: sortItems(group.items),
    }))
    .toSorted((a, b) => getItemTime(b.items[0]) - getItemTime(a.items[0]));
};

const groupNotifications = (
  notifications: UnifiedNotification[]
): NotificationInboxItem[] => {
  const sorted = sortNotifications(notifications);
  const githubGroups = new Map<string, UnifiedNotification[]>();
  const channelNotifications: UnifiedNotification[] = [];
  const items: NotificationInboxItem[] = [];

  for (const notification of sorted) {
    if (notification.notification_metadata.tag === 'github_pr_event') {
      const key = getGithubGroupKey(notification);
      githubGroups.set(key, [...(githubGroups.get(key) ?? []), notification]);
      continue;
    }

    if (isChannelInboxNotification(notification)) {
      channelNotifications.push(notification);
      continue;
    }

    items.push({
      id: `notification:${notification.id}`,
      type: 'notification',
      notification,
    });
  }

  for (const [key, groupNotifications] of githubGroups) {
    const notifications = sortNotifications(groupNotifications);
    const first = notifications[0];
    const metadata = first.notification_metadata;
    if (metadata.tag !== 'github_pr_event') continue;

    items.push({
      id: `github:${key}`,
      type: 'github',
      group: {
        id: key,
        title: metadata.content.title || metadata.content.displayName,
        subtitle: `${metadata.content.owner}/${metadata.content.repo}#${metadata.content.number}`,
        status: metadata.content.status,
        url: metadata.content.url,
        authorId: first.sender_id ?? undefined,
        authorFallback: metadata.content.senderGithubLogin ?? undefined,
        notifications,
        subItems: notifications.filter(
          (notification) => !isGithubStatusNotification(notification)
        ),
      },
    });
  }

  let consecutiveSendStack: UnifiedNotification[] = [];

  const flushConsecutiveSendStack = () => {
    if (consecutiveSendStack.length === 0) return;
    const notifications = sortNotifications(consecutiveSendStack);

    if (notifications.length === 1) {
      items.push({
        id: `notification:${notifications[0].id}`,
        type: 'notification',
        notification: notifications[0],
      });
    } else {
      items.push({
        id: `channel:sends:${notifications.map((n) => n.id).join(':')}`,
        type: 'channel',
        group: {
          id: `sends:${notifications[0].id}`,
          notifications,
          subItems: notifications.slice(1),
        },
      });
    }

    consecutiveSendStack = [];
  };

  const channelGroupEntries = [
    ...createChannelThreadGroups(channelNotifications),
  ]
    .map(
      ([key, groupNotifications]) =>
        [key, sortNotifications(groupNotifications)] as const
    )
    .toSorted(
      ([, a], [, b]) => getNotificationTime(b[0]) - getNotificationTime(a[0])
    );

  for (const [key, notifications] of channelGroupEntries) {
    if (notifications.length === 1 && isChannelMessageSend(notifications[0])) {
      const previous = consecutiveSendStack.at(-1);

      if (
        previous &&
        getConsecutiveChannelSendStackKey(previous) !==
          getConsecutiveChannelSendStackKey(notifications[0])
      ) {
        flushConsecutiveSendStack();
      }

      consecutiveSendStack.push(notifications[0]);
      continue;
    }

    flushConsecutiveSendStack();

    if (notifications.length === 1) {
      items.push({
        id: `notification:${notifications[0].id}`,
        type: 'notification',
        notification: notifications[0],
      });
      continue;
    }

    items.push({
      id: `channel:${key}`,
      type: 'channel',
      group: {
        id: key,
        notifications,
        subItems: notifications.slice(1),
      },
    });
  }

  flushConsecutiveSendStack();

  return sortItems(items);
};

function DateGroupHeader(props: { label: string }) {
  return (
    <div class="sticky top-0 z-10 bg-surface py-2">
      <span class="rounded-sm px-3 py-1 text-xs text-ink-extra-muted ring ring-rail">
        {props.label}
      </span>
    </div>
  );
}

function ChannelStackSenderLabel(props: {
  senderKey: string;
  fallbackNotification: UnifiedNotification;
}) {
  const macroId = () => tryMacroId(props.senderKey);
  const [displayName] = useDisplayName(macroId());
  const fallback = () => getChannelSenderLabel(props.fallbackNotification);

  return <>{displayName() || fallback()}</>;
}

function ChannelStackSenders(props: { stack: ChannelNotificationStack }) {
  const senderKeys = () => getChannelStackSenderKeys(props.stack);
  const fallbackForSender = (senderKey: string) =>
    props.stack.notifications.find(
      (notification) => getChannelSenderKey(notification) === senderKey
    ) ?? props.stack.notifications[0];

  return (
    <For each={senderKeys()}>
      {(senderKey, index) => (
        <>
          <Show when={index() > 0}>{', '}</Show>
          <ChannelStackSenderLabel
            senderKey={senderKey}
            fallbackNotification={fallbackForSender(senderKey)}
          />
        </>
      )}
    </For>
  );
}

function ChannelNotificationStackRow(props: {
  stack: ChannelNotificationStack;
  listEntityLayout?: NotificationListLayout;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const notifications = () => sortNotifications(props.stack.notifications);
  const isStack = () => notifications().length > 1;
  const toggle = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded((value) => !value);
  };

  return (
    <Show
      when={isStack()}
      fallback={
        <NotificationListEntity
          notification={notifications()[0]}
          layout={props.listEntityLayout}
        />
      }
    >
      <div class="flex flex-col">
        <div
          class="group/notif grid min-w-0 cursor-pointer grid-cols-[1rem_1rem_minmax(0,1fr)_1rem] grid-rows-[auto_auto] gap-x-1.5 gap-y-0.5 overflow-hidden rounded-lg bg-surface px-2 py-2 hover:bg-ink-muted/6"
          onClick={toggle}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') toggle(e);
          }}
        >
          <span class="col-start-1 row-start-1 grid size-4 place-items-center">
            <span
              class={cn(
                'rounded-sm px-1 py-0.5 text-[10px] font-medium leading-none tabular-nums',
                getChannelStackUnreadCount(props.stack) > 0
                  ? 'bg-accent/10 text-accent'
                  : 'bg-ink-muted/8 text-ink-extra-muted'
              )}
            >
              {props.stack.notifications.length}
            </span>
          </span>
          <span class="col-start-2 row-start-1 grid size-4 place-items-center self-center">
            <Show
              when={
                isDirectMessageNotification(notifications()[0]) &&
                tryMacroId(getChannelSenderKey(notifications()[0]))
              }
              fallback={
                <EntityIcon
                  targetType={getChannelIconType(notifications()[0])}
                  size="sm"
                />
              }
            >
              {(senderId) => (
                <UserIcon id={senderId()} size="sm" suppressClick showTooltip />
              )}
            </Show>
          </span>
          <span class="col-start-3 row-start-1 flex min-w-0 items-center gap-1.5 pl-1 text-xs font-medium text-ink">
            <span class="min-w-0 truncate">
              {getChannelName(notifications()[0])}
            </span>
          </span>
          <span
            class={cn(
              'col-start-4 row-start-1 row-span-2 grid size-4 place-items-center self-center justify-self-end text-ink-extra-muted transition-transform',
              expanded() && 'rotate-180'
            )}
          >
            <CaretDownIcon class="size-3" />
          </span>
          <span class="col-start-3 row-start-2 min-w-0 truncate pl-1 text-[11px] leading-3 text-ink-muted/60">
            <ChannelStackSenders stack={props.stack} />
          </span>
        </div>
        <Show when={expanded()}>
          <div
            class={cn(
              'ml-4 mt-1 rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden',
              props.listEntityLayout === 'multirow' ? 'mr-0' : 'mr-2'
            )}
          >
            <For each={notifications()}>
              {(notification) => (
                <NotificationListEntity
                  notification={notification}
                  layout={props.listEntityLayout}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function ChannelNotificationGroupRow(props: {
  group: ChannelNotificationGroup;
  listEntityLayout?: NotificationListLayout;
}) {
  const stacks = () =>
    stackConsecutiveChannelNotifications(props.group.notifications);
  const subStacks = () => stacks().slice(1);

  return (
    <section class="soup-list-entity w-full py-0.5 flex flex-col gap-1">
      <div class="group/header rounded-lg bg-surface relative">
        <ChannelNotificationStackRow
          stack={stacks()[0]}
          listEntityLayout={props.listEntityLayout}
        />
      </div>
      <Show when={subStacks().length > 0}>
        <div class="rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden">
          <For each={subStacks()}>
            {(stack) => (
              <ChannelNotificationStackRow
                stack={stack}
                listEntityLayout={props.listEntityLayout}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

function NotificationInboxItemRow(props: {
  item: NotificationInboxItem;
  listEntityLayout?: NotificationListLayout;
}) {
  return (
    <Switch>
      <Match when={props.item.type === 'github' ? props.item.group : undefined}>
        {(group) => (
          <Show
            when={group().subItems.length > 0}
            fallback={
              <div class="soup-list-entity w-full py-0.5">
                <GithubNotificationListEntity
                  notification={group().notifications[0]}
                  title={group().title}
                  subtitle={group().subtitle}
                  status={group().status}
                  url={group().url}
                  authorId={group().authorId}
                  authorFallback={group().authorFallback}
                  layout={props.listEntityLayout}
                />
              </div>
            }
          >
            <section class="soup-list-entity w-full py-0.5 flex flex-col gap-1">
              <div class="group/header rounded-lg bg-surface relative">
                <GithubNotificationListEntity
                  notification={group().notifications[0]}
                  title={group().title}
                  subtitle={group().subtitle}
                  status={group().status}
                  url={group().url}
                  authorId={group().authorId}
                  authorFallback={group().authorFallback}
                  layout={props.listEntityLayout}
                />
              </div>
              <div class="rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden">
                <div>
                  <For each={group().subItems}>
                    {(notification) => (
                      <GithubNotificationListEntity
                        notification={notification}
                        layout={props.listEntityLayout}
                      />
                    )}
                  </For>
                </div>
              </div>
            </section>
          </Show>
        )}
      </Match>
      <Match
        when={props.item.type === 'channel' ? props.item.group : undefined}
      >
        {(group) => (
          <ChannelNotificationGroupRow
            group={group()}
            listEntityLayout={props.listEntityLayout}
          />
        )}
      </Match>
      <Match when={props.item.type === 'notification' ? props.item : undefined}>
        {(item) => (
          <NotificationListEntity
            notification={item().notification}
            layout={props.listEntityLayout}
          />
        )}
      </Match>
    </Switch>
  );
}

function NotificationInboxItems(props: {
  groups: NotificationDateGroup[];
  listEntityLayout?: NotificationListLayout;
}) {
  return (
    <div class="unified-table-body w-full flex flex-col gap-1 flex-1 min-h-0 relative overflow-y-auto px-2 pb-2">
      <For each={props.groups}>
        {(group, index) => (
          <section class="flex flex-col gap-1">
            <DateGroupHeader label={group.label} />
            <For each={group.items}>
              {(item) => (
                <NotificationInboxItemRow
                  item={item}
                  listEntityLayout={props.listEntityLayout}
                />
              )}
            </For>
            <Show when={index() < props.groups.length - 1}>
              <div class="h-4 shrink-0" />
            </Show>
          </section>
        )}
      </For>
    </div>
  );
}

function NotificationInboxListLayout(props: {
  groups: NotificationDateGroup[];
  isLoading: boolean;
  listEntityLayout?: NotificationListLayout;
}) {
  return (
    <div class="@container/u-list size-full min-h-0 unified-list-root flex flex-col">
      <Show when={!props.isLoading} fallback={<LoadingBlock />}>
        <Show
          when={props.groups.length > 0}
          fallback={
            <div class="flex size-full items-center justify-center text-sm text-ink-muted">
              No notifications
            </div>
          }
        >
          <NotificationInboxItems
            groups={props.groups}
            listEntityLayout={props.listEntityLayout}
          />
        </Show>
      </Show>
    </div>
  );
}

function NotificationInboxPreviewLayout(props: {
  groups: NotificationDateGroup[];
  isLoading: boolean;
}) {
  return (
    <div class="grid size-full min-h-0 grid-cols-[minmax(22rem,0.42fr)_minmax(0,1fr)] overflow-hidden">
      <div class="min-w-0 min-h-0 border-r border-edge-muted">
        <NotificationInboxListLayout
          groups={props.groups}
          isLoading={props.isLoading}
          listEntityLayout="multirow"
        />
      </div>
      <div class="min-w-0 bg-surface/50 p-4">
        <div class="flex size-full items-center justify-center rounded-lg border border-dashed border-edge-muted text-sm text-ink-extra-muted">
          Preview
        </div>
      </div>
    </div>
  );
}

export function NotificationInbox2() {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const [layout, setLayout] = createSignal<'list' | 'preview'>('preview');

  createEffect(() => {
    panel.handle.setDisplayName('Inbox 2');
  });

  const [dateGroups, setDateGroups] = createStore<NotificationDateGroup[]>([]);

  createEffect(() => {
    const next = groupItemsByDate(
      groupNotifications(
        notificationSource
          .notifications()
          .filter((notification) => !notification.deleted_at)
      )
    );

    setDateGroups(reconcile(next, { key: 'id' }));
  });

  return (
    <div class="size-full flex flex-col" data-list-view="inbox2">
      <div class="flex flex-col w-full">
        <SplitHeaderLeft>
          <div class="h-full flex gap-3 items-center shrink-0">
            <span class="text-base font-bold">Inbox 2</span>
          </div>
        </SplitHeaderLeft>
        <SplitToolbarLeft>
          <div class="flex items-start gap-1 min-w-0 flex-1">
            <Button
              variant="base"
              size="sm"
              depth={2}
              class="bg-surface"
              disabled
            >
              <SortAscendingIcon class="size-3.5" />
              <span>Sort</span>
            </Button>
            <Button
              variant="base"
              size="sm"
              depth={2}
              class="bg-surface"
              disabled
            >
              <StackIcon class="size-3.5" />
              <span>Group</span>
            </Button>
            <Button
              variant="base"
              size="sm"
              depth={2}
              class="bg-surface"
              disabled
            >
              <FunnelIcon class="size-3.5" />
              <span>Filter</span>
            </Button>
          </div>
        </SplitToolbarLeft>
        <SplitToolbarRight>
          <Button
            variant={layout() === 'preview' ? 'active' : 'base'}
            size="sm"
            depth={2}
            class="bg-surface"
            onClick={() =>
              setLayout((value) => (value === 'preview' ? 'list' : 'preview'))
            }
          >
            <EyeIcon class="size-3.5" />
            <span>{layout() === 'preview' ? 'List' : 'Preview'}</span>
          </Button>
        </SplitToolbarRight>
      </div>

      <div class="relative grow min-h-1 size-full">
        <Switch>
          <Match when={layout() === 'preview'}>
            <NotificationInboxPreviewLayout
              groups={dateGroups}
              isLoading={notificationSource.isLoading()}
            />
          </Match>
          <Match when={true}>
            <NotificationInboxListLayout
              groups={dateGroups}
              isLoading={notificationSource.isLoading()}
            />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
