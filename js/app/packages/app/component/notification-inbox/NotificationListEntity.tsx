import './NotificationListEntity.css';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import { Entity, formatTimestamp, NotificationRow } from '@entity';
import GithubIcon from '@icon/mcp-github.svg';
import { openNotification, type UnifiedNotification } from '@notifications';
import GitMergeIcon from '@phosphor-icons/core/regular/git-merge.svg?component-solid';
import GitPullRequestIcon from '@phosphor-icons/core/regular/git-pull-request.svg?component-solid';
import XCircleIcon from '@phosphor-icons/core/regular/x-circle.svg?component-solid';
import type { GithubPrEventStatus } from '@service-notification/generated/schemas';
import { Avatar, Button, cn, Tooltip } from '@ui';
import { createEffect, createSignal, For, Show } from 'solid-js';
import { StackedNotificationIcon } from './StackedNotificationIcon';

interface NotificationListEntityProps {
  notification: UnifiedNotification;
  highlighted?: boolean;
  stacked?: boolean;
  collapsedCount?: number;
  collapsedNotifications?: UnifiedNotification[];
  layout?: 'compact' | 'multirow';
}

const getNotificationDate = (notification: UnifiedNotification): Date =>
  new Date(notification.created_at ?? notification.updated_at ?? 0);

function NotificationListTimestamp(props: {
  notification: UnifiedNotification;
}) {
  return <>{formatTimestamp(getNotificationDate(props.notification))}</>;
}

const getEmailContent = (notification: UnifiedNotification) => {
  const metadata = notification.notification_metadata;
  return metadata.tag === 'new_email' ? metadata.content : undefined;
};

function NotificationListDescription(props: {
  notification: UnifiedNotification;
}) {
  const email = () => getEmailContent(props.notification);
  const macroId = () =>
    props.notification.sender_id
      ? tryMacroId(props.notification.sender_id)
      : undefined;
  const [displayName] = useDisplayName(macroId());
  const senderName = () =>
    displayName() || email()?.sender || props.notification.sender_id || 'Email';

  return (
    <Show
      when={email()}
      fallback={
        <Entity.Notification.Description notification={props.notification} />
      }
    >
      {senderName()}
    </Show>
  );
}

function EmailNotificationListRow(props: {
  notification: UnifiedNotification;
}) {
  const notificationSource = useGlobalNotificationSource();
  const email = () => getEmailContent(props.notification);
  const unread = () =>
    !props.notification.viewed_at && !props.notification.done;

  const handleOpen = async (e: MouseEvent | KeyboardEvent) => {
    const splitManager = globalSplitManager();
    if (!splitManager) return;
    e.stopPropagation();
    await openNotification(props.notification, splitManager, e.shiftKey);
    await notificationSource.markAsRead(props.notification);
  };

  return (
    <div class="relative z-1 bg-surface shadow-[0_1px_0_rgb(from_var(--color-ink)_r_g_b_/_0.04)]">
      <div
        class="group/notif @container/notif-row flex items-center gap-2.5 px-3 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden cursor-pointer"
        onClick={handleOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleOpen(e);
          }
        }}
      >
        <span
          class={cn('size-1.5 rounded-full shrink-0', {
            'bg-accent': unread(),
            'bg-transparent': !unread(),
          })}
        />
        <Entity.Notification.Icon
          notification={props.notification}
          class="size-3.5 shrink-0 text-ink-muted/60"
        />
        <span
          class={cn('ph-no-capture truncate min-w-0 text-xs text-ink', {
            'font-medium': unread(),
          })}
        >
          <NotificationListDescription notification={props.notification} />
        </span>
        <span class="hidden @md/notif-row:flex flex-1 min-w-0 ph-no-capture truncate text-xs text-ink-muted/60">
          <Show when={email()}>
            {(content) => (
              <>
                <span class="text-ink">{content().subject}</span>
                <Show when={content().snippet}>
                  {(snippet) => (
                    <span class="text-ink-extra-muted"> — {snippet()}</span>
                  )}
                </Show>
              </>
            )}
          </Show>
        </span>
        <div class="shrink-0 ml-auto h-5 flex items-center justify-end">
          <span class="text-xs text-right text-ink-extra-muted font-medium">
            <NotificationListTimestamp notification={props.notification} />
          </span>
        </div>
      </div>
    </div>
  );
}

export function NotificationListEntity(props: NotificationListEntityProps) {
  if (props.layout === 'multirow') {
    return <MultirowNotificationListEntity {...props} />;
  }

  const collapsedCount = () => props.collapsedCount ?? 1;
  const hasCollapsedItems = () => collapsedCount() > 1;
  const [expanded, setExpanded] = createSignal(false);
  const collapsedNotifications = () => props.collapsedNotifications ?? [];

  return (
    <div
      class={cn(
        '@container/entity relative group/narrow flex flex-col',
        props.stacked
          ? 'w-full'
          : 'soup-list-entity w-[calc(100%-0.5rem)] mr-1 py-0.5 mx-1',
        props.highlighted && 'ring ring-edge bg-active/60 ring-inset'
      )}
    >
      <Show
        when={hasCollapsedItems()}
        fallback={
          <Show
            when={getEmailContent(props.notification)}
            fallback={
              <div class="relative z-1 bg-surface shadow-[0_1px_0_rgb(from_var(--color-ink)_r_g_b_/_0.04)]">
                <NotificationRow
                  notification={props.notification}
                  variant="compact"
                />
              </div>
            }
          >
            <EmailNotificationListRow notification={props.notification} />
          </Show>
        }
      >
        <CollapsedNotificationListEntityRow
          notification={props.notification}
          count={collapsedCount()}
          expanded={expanded()}
          onToggle={() => setExpanded((value) => !value)}
        />
      </Show>
      <Show when={hasCollapsedItems() && expanded()}>
        <div class="ml-12 mr-2 mt-1 rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden divide-y divide-ink-muted/8">
          <For each={collapsedNotifications()}>
            {(notification) => (
              <NotificationRow notification={notification} variant="compact" />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function NotificationContentPreview(props: {
  notification: UnifiedNotification;
}) {
  return (
    <Show
      when={getEmailContent(props.notification)}
      fallback={
        <Entity.Notification.Content
          notification={props.notification}
          singleLine
        />
      }
    >
      {(content) => (
        <>
          <span class="text-ink">{content().subject}</span>
          <Show when={content().snippet}>
            {(snippet) => (
              <span class="text-ink-extra-muted"> — {snippet()}</span>
            )}
          </Show>
        </>
      )}
    </Show>
  );
}

function MultirowNotificationListRow(props: {
  notification: UnifiedNotification;
  count?: number;
  isStack?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const notificationSource = useGlobalNotificationSource();
  const [reloading, setReloading] = createSignal(false);
  const [previousCount, setPreviousCount] = createSignal(props.count ?? 1);
  const unread = () =>
    !props.notification.viewed_at && !props.notification.done;
  const count = () => props.count ?? 1;

  createEffect(() => {
    if (!props.isStack) return;

    const previous = previousCount();
    const current = count();

    if (current < previous && current > 1) {
      setReloading(true);
      window.setTimeout(() => setReloading(false), 180);
    }

    setPreviousCount(current);
  });

  const handleOpen = async (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();

    if (props.isStack) {
      e.preventDefault();
      props.onToggle?.();
      return;
    }

    const splitManager = globalSplitManager();
    if (!splitManager) return;
    await openNotification(props.notification, splitManager, e.shiftKey);
    await notificationSource.markAsRead(props.notification);
  };

  return (
    <div class="relative z-1 bg-surface shadow-[0_1px_0_rgb(from_var(--color-ink)_r_g_b_/_0.04)]">
      <div
        class="group/notif grid grid-cols-[1rem_1rem_minmax(0,1fr)_5rem] grid-rows-[auto_auto] gap-x-2 gap-y-1 px-3 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden cursor-pointer"
        onClick={handleOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleOpen(e);
          }
        }}
      >
        <span class="col-start-1 row-start-1 grid size-4 place-items-center">
          <Show
            when={props.isStack && count() > 1}
            fallback={
              <span
                class={cn('size-1.5 rounded-full', {
                  'bg-accent': unread(),
                  'bg-transparent': !unread(),
                })}
              />
            }
          >
            <span class="grid size-4 place-items-center rounded-sm bg-accent/10 text-[10px] font-medium leading-none text-accent tabular-nums">
              {count()}
            </span>
          </Show>
        </span>
        <span class="col-start-2 row-start-1 grid size-4 place-items-center text-ink-muted/60">
          <Show
            when={props.isStack}
            fallback={
              <Entity.Notification.Icon
                notification={props.notification}
                class="size-3.5"
              />
            }
          >
            <StackedNotificationIcon
              notification={props.notification}
              count={count()}
              reloading={reloading()}
            />
          </Show>
        </span>
        <div class="col-start-3 row-start-1 min-w-0 flex items-center gap-1.5">
          <span
            class={cn('ph-no-capture truncate min-w-0 text-xs text-ink', {
              'font-medium': unread(),
            })}
          >
            <NotificationListDescription notification={props.notification} />
          </span>
        </div>
        <span class="col-start-4 row-start-1 justify-self-end text-xs text-right text-ink-extra-muted font-medium">
          <NotificationListTimestamp notification={props.notification} />
        </span>
        <div class="col-start-3 col-span-2 row-start-2 min-w-0 ph-no-capture truncate text-xs text-ink-muted/60">
          <NotificationContentPreview notification={props.notification} />
        </div>
      </div>
    </div>
  );
}

function MultirowNotificationListEntity(props: NotificationListEntityProps) {
  const collapsedCount = () => props.collapsedCount ?? 1;
  const hasCollapsedItems = () => collapsedCount() > 1;
  const [expanded, setExpanded] = createSignal(false);
  const collapsedNotifications = () => props.collapsedNotifications ?? [];

  return (
    <div
      class={cn(
        '@container/entity relative group/narrow flex flex-col',
        props.stacked
          ? 'w-full'
          : 'soup-list-entity w-[calc(100%-0.5rem)] mr-1 py-0.5 mx-1',
        props.highlighted && 'ring ring-edge bg-active/60 ring-inset'
      )}
    >
      <MultirowNotificationListRow
        notification={props.notification}
        count={collapsedCount()}
        isStack={hasCollapsedItems()}
        expanded={expanded()}
        onToggle={() => setExpanded((value) => !value)}
      />
      <Show when={hasCollapsedItems() && expanded()}>
        <div class="ml-12 mr-2 mt-1 rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden divide-y divide-ink-muted/8">
          <For each={collapsedNotifications()}>
            {(notification) => (
              <MultirowNotificationListRow notification={notification} />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function CollapsedNotificationListEntityRow(props: {
  notification: UnifiedNotification;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [reloading, setReloading] = createSignal(false);
  const [previousCount, setPreviousCount] = createSignal(props.count);
  const unread = () =>
    !props.notification.viewed_at && !props.notification.done;
  const canMarkDone = () => true;

  createEffect(() => {
    const previous = previousCount();
    const current = props.count;

    if (current < previous && current > 1) {
      setReloading(true);
      window.setTimeout(() => setReloading(false), 180);
    }

    setPreviousCount(current);
  });

  const toggle = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    props.onToggle();
  };

  return (
    <div
      class="relative z-1 bg-surface shadow-[0_1px_0_rgb(from_var(--color-ink)_r_g_b_/_0.04)]"
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          toggle(e);
        }
      }}
    >
      <div class="group/notif flex items-center gap-2.5 px-3 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden cursor-pointer">
        <span class="grid size-4 shrink-0 place-items-center">
          <Show
            when={props.count > 1}
            fallback={
              <span
                class={cn('size-1.5 rounded-full', {
                  'bg-accent': unread(),
                  'bg-transparent': !unread(),
                })}
              />
            }
          >
            <span class="grid size-4 place-items-center rounded-sm bg-accent/10 text-[10px] font-medium leading-none text-accent tabular-nums">
              {props.count}
            </span>
          </Show>
        </span>
        <button
          type="button"
          class="relative -ml-1 -mr-0.5 shrink-0 size-5 grid place-items-center rounded-md hover:bg-ink-muted/6 outline-none focus-visible:bg-active"
          title={props.expanded ? 'Collapse messages' : 'Expand messages'}
          onClick={toggle}
        >
          <StackedNotificationIcon
            notification={props.notification}
            count={props.count}
            reloading={reloading()}
          />
        </button>
        <span
          class={cn('ph-no-capture truncate min-w-0 text-xs text-ink', {
            'font-medium': unread(),
          })}
        >
          <NotificationListDescription notification={props.notification} />
        </span>
        <span class="hidden @md/notif-row:flex flex-1 min-w-0 ph-no-capture truncate text-xs text-ink-muted/60">
          <Entity.Notification.Content
            notification={props.notification}
            singleLine
          />
        </span>
        <div class="shrink-0 ml-auto h-5 flex items-center justify-end">
          <span
            class={cn('text-xs text-right text-ink-extra-muted font-medium', {
              'group-hover/notif:hidden': canMarkDone(),
            })}
          >
            <NotificationListTimestamp notification={props.notification} />
          </span>
        </div>
      </div>
    </div>
  );
}

const GITHUB_GRID_TEMPLATE_COLUMNS =
  '1rem minmax(0, 1fr) var(--github-col-author, 8rem) var(--github-col-link, 12rem) var(--github-col-timestamp, 5rem)';
const GITHUB_GRID_TEMPLATE_AREAS = '"indicator content author link timestamp"';

export function GithubNotificationListHeader(props: { class?: string }) {
  return (
    <div
      class={cn(
        'github-grid-row w-full grid items-center gap-2 px-2 h-10',
        'text-xs font-medium text-ink-extra-muted',
        'bg-surface',
        props.class
      )}
      style={{
        'grid-template-columns': GITHUB_GRID_TEMPLATE_COLUMNS,
        'grid-template-areas': GITHUB_GRID_TEMPLATE_AREAS,
      }}
    >
      <div style={{ 'grid-area': 'indicator' }} />
      <GithubHeaderCell gridArea="content" label="Update" />
      <GithubHeaderCell gridArea="author" label="Author" />
      <GithubHeaderCell gridArea="link" label="GitHub" />
      <GithubHeaderCell gridArea="timestamp" label="Updated" align="end" />
    </div>
  );
}

function GithubHeaderCell(props: {
  gridArea: string;
  label: string;
  align?: 'start' | 'end';
}) {
  const justify = () =>
    props.align === 'end' ? 'justify-end' : 'justify-start';

  return (
    <div
      style={{ 'grid-area': props.gridArea }}
      class={cn('flex items-center min-w-0', justify())}
    >
      <span class="truncate">{props.label}</span>
    </div>
  );
}

const getInitials = (value: string): string => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.[0] ?? '?').toUpperCase();
};

function NotificationAuthor(props: { id?: string; fallback?: string }) {
  const macroId = () => (props.id ? tryMacroId(props.id) : undefined);
  const [displayName] = useDisplayName(macroId());
  const label = () => displayName() || props.fallback || props.id || 'Unknown';

  return (
    <Tooltip label={label()}>
      <div class="flex items-center gap-1 text-xs text-ink-muted">
        <Show
          when={macroId() && props.id}
          fallback={
            <Avatar size="sm">
              <Avatar.Fallback class="font-semibold">
                {getInitials(label())}
              </Avatar.Fallback>
            </Avatar>
          }
        >
          {(id) => (
            <UserIcon id={id()} size="sm" suppressClick showTooltip={false} />
          )}
        </Show>
        <span class="truncate">{label()}</span>
      </div>
    </Tooltip>
  );
}

const getGithubContent = (notification: UnifiedNotification) => {
  const metadata = notification.notification_metadata;
  return metadata.tag === 'github_pr_event' ? metadata.content : undefined;
};

const getGithubStatusIcon = (status: GithubPrEventStatus) => {
  switch (status) {
    case 'open':
      return GitPullRequestIcon;
    case 'closed':
      return XCircleIcon;
    case 'merged':
      return GitMergeIcon;
  }
};

const getGithubStatusClass = (status: GithubPrEventStatus): string => {
  switch (status) {
    case 'open':
      return 'text-success';
    case 'closed':
      return 'text-failure';
    case 'merged':
      return 'text-note';
  }
};

function GithubLinkPill(props: { url?: string; label?: string }) {
  return (
    <Show
      when={props.url}
      fallback={
        <span class="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-edge-muted px-1.5 py-0.5 text-xs text-ink-muted overflow-hidden">
          <GithubIcon class="size-3.5 shrink-0" />
          <span class="truncate min-w-0">{props.label ?? 'GitHub'}</span>
        </span>
      }
    >
      {(url) => (
        <Button
          variant="ghost"
          size="sm"
          class="[&_:where(svg)]:size-3.5 w-full max-w-full justify-start gap-1 rounded-full border border-edge-muted bg-surface px-1 py-0.5 text-xs text-ink-muted h-auto min-w-0 overflow-hidden"
          noTouchResize
          tooltip="Open pull request"
          onClick={(e) => {
            e.stopPropagation();
            window.open(url(), '_blank', 'noreferrer');
          }}
        >
          <GithubIcon class="shrink-0" />
          <span class="truncate min-w-0">{props.label ?? 'GitHub'}</span>
        </Button>
      )}
    </Show>
  );
}

export function GithubNotificationListEntity(props: {
  notification: UnifiedNotification;
  title?: string;
  subtitle?: string;
  status?: GithubPrEventStatus;
  url?: string;
  authorId?: string;
  authorFallback?: string;
  layout?: 'compact' | 'multirow';
}) {
  const github = () => getGithubContent(props.notification);
  const unread = () =>
    !props.notification.viewed_at && !props.notification.done;
  const title = () => props.title ?? github()?.action ?? '';
  const description = () => (props.title ? undefined : github()?.displayName);
  const status = () => props.status ?? github()?.status;
  const url = () => props.url ?? github()?.url;
  const subtitle = () => props.subtitle ?? github()?.githubKey;
  const authorId = () =>
    props.authorId ?? props.notification.sender_id ?? undefined;
  const authorFallback = () =>
    props.authorFallback ?? github()?.senderGithubLogin ?? undefined;
  const timestamp = () =>
    formatTimestamp(getNotificationDate(props.notification));

  const contentSlot = () => (
    <>
      <Show when={status()}>
        {(value) => {
          const StatusIcon = getGithubStatusIcon(value());
          return (
            <StatusIcon
              class={cn('size-3.5 shrink-0', getGithubStatusClass(value()))}
            />
          );
        }}
      </Show>
      <span
        class={cn('truncate min-w-0 text-ink-muted', {
          'text-ink font-semibold': unread(),
        })}
      >
        {title()}
      </span>
      <Show when={description()}>
        {(value) => (
          <span class="truncate min-w-0 text-xs font-normal text-ink-muted/60">
            {value()}
          </span>
        )}
      </Show>
    </>
  );

  const authorPill = () => (
    <div class="inline-flex max-w-full min-w-0 items-center rounded-full border border-edge-muted px-1 py-0.5 overflow-hidden">
      <NotificationAuthor id={authorId()} fallback={authorFallback()} />
    </div>
  );

  return (
    <Show
      when={github()}
      fallback={
        <NotificationListEntity notification={props.notification} stacked />
      }
    >
      <Show
        when={props.layout === 'multirow'}
        fallback={
          <div
            class="group/notif grid min-h-10 items-center gap-2 px-2 py-1.5 hover:bg-ink-muted/6 min-w-0 overflow-hidden"
            style={{
              'grid-template-columns': GITHUB_GRID_TEMPLATE_COLUMNS,
              'grid-template-areas': GITHUB_GRID_TEMPLATE_AREAS,
            }}
          >
            <div
              style={{ 'grid-area': 'indicator' }}
              class="grid place-items-center"
            >
              <span
                class={cn('size-1.5 rounded-full', {
                  'bg-accent': unread(),
                  'bg-transparent': !unread(),
                })}
              />
            </div>
            <div
              style={{ 'grid-area': 'content' }}
              class="min-w-0 flex items-center gap-1.5 text-xs font-semibold tracking-tight"
            >
              {contentSlot()}
            </div>
            <div
              style={{ 'grid-area': 'author' }}
              class="min-w-0 overflow-hidden"
            >
              {authorPill()}
            </div>
            <div
              style={{ 'grid-area': 'link' }}
              class="min-w-0 overflow-hidden flex items-center"
            >
              <GithubLinkPill url={url()} label={subtitle()} />
            </div>
            <span
              style={{ 'grid-area': 'timestamp' }}
              class="shrink-0 text-xs text-right text-ink-extra-muted font-medium"
            >
              {timestamp()}
            </span>
          </div>
        }
      >
        <div class="group/notif grid grid-cols-[1rem_minmax(0,1fr)_5rem] grid-rows-[auto_auto] gap-x-2 gap-y-1 px-2 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden">
          <div class="col-start-1 row-start-1 grid place-items-center">
            <span
              class={cn('size-1.5 rounded-full', {
                'bg-accent': unread(),
                'bg-transparent': !unread(),
              })}
            />
          </div>
          <div class="col-start-2 row-start-1 min-w-0 flex items-center gap-1.5 text-xs font-semibold tracking-tight">
            {contentSlot()}
          </div>
          <span class="col-start-3 row-start-1 justify-self-end shrink-0 text-xs text-right text-ink-extra-muted font-medium">
            {timestamp()}
          </span>
          <div class="col-start-2 col-span-2 row-start-2 min-w-0 flex items-center gap-1.5 overflow-hidden">
            <div class="min-w-0 max-w-[45%] overflow-hidden">
              {authorPill()}
            </div>
            <div class="min-w-0 flex-1 overflow-hidden">
              <GithubLinkPill url={url()} label={subtitle()} />
            </div>
          </div>
        </div>
      </Show>
    </Show>
  );
}
