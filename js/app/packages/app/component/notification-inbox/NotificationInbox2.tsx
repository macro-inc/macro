import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { LoadingBlock } from '@core/component/LoadingBlock';
import type { UnifiedNotification } from '@notifications';
import FunnelIcon from '@phosphor/funnel.svg';
import SortAscendingIcon from '@phosphor/sort-ascending.svg';
import StackIcon from '@phosphor/stack.svg';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import type { GithubPrEventStatus } from '@service-notification/generated/schemas';
import { Button } from '@ui';
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

type NotificationInboxItem =
  | { id: string; type: 'notification'; notification: UnifiedNotification }
  | { id: string; type: 'github'; group: GithubNotificationGroup };

type NotificationDateGroup = {
  id: string;
  label: string;
  items: NotificationInboxItem[];
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

const getItemPrimaryNotification = (
  item: NotificationInboxItem
): UnifiedNotification =>
  item.type === 'github' ? item.group.notifications[0] : item.notification;

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

  return Array.from(groups.values());
};

const groupNotifications = (
  notifications: UnifiedNotification[]
): NotificationInboxItem[] => {
  const sorted = sortNotifications(notifications);
  const githubGroups = new Map<string, UnifiedNotification[]>();
  const items: NotificationInboxItem[] = [];

  for (const notification of sorted) {
    if (notification.notification_metadata.tag !== 'github_pr_event') {
      items.push({
        id: `notification:${notification.id}`,
        type: 'notification',
        notification,
      });
      continue;
    }

    const key = getGithubGroupKey(notification);
    githubGroups.set(key, [...(githubGroups.get(key) ?? []), notification]);
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

  return items.toSorted(
    (a, b) =>
      getNotificationTime(getItemPrimaryNotification(b)) -
      getNotificationTime(getItemPrimaryNotification(a))
  );
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

function NotificationInboxItemRow(props: {
  item: NotificationInboxItem;
  listEntityLayout?: NotificationListLayout;
}) {
  return (
    <Show
      when={props.item.type === 'github' ? props.item.group : undefined}
      fallback={
        <NotificationListEntity
          notification={
            props.item.type === 'notification'
              ? props.item.notification
              : props.item.group.notifications[0]
          }
          layout={props.listEntityLayout}
        />
      }
    >
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
              <div class="divide-y divide-ink-muted/8">
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
    </Show>
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
