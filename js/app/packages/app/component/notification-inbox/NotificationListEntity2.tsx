import './NotificationListEntity.css';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import { Entity, NotificationRow } from '@entity';
import LogoIcon from '@icon/macro-logo.svg';
import GithubIcon from '@icon/mcp-github.svg';
import { openNotification, type UnifiedNotification } from '@notifications';
import GitMergeIcon from '@phosphor-icons/core/regular/git-merge.svg?component-solid';
import GitPullRequestIcon from '@phosphor-icons/core/regular/git-pull-request.svg?component-solid';
import XCircleIcon from '@phosphor-icons/core/regular/x-circle.svg?component-solid';
import type { GithubPrEventStatus } from '@service-notification/generated/schemas';
import { Avatar, cn } from '@ui';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { createEffect, createSignal, For, Show } from 'solid-js';
import { ChannelNotificationMessageLayout } from './ChannelNotificationMessageLayout';
import { NotificationListIcon } from './NotificationListIcon';
import { NotificationMessageLayout } from './NotificationMessageLayout';
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
  return <>{format(getNotificationDate(props.notification), 'h:mm a')}</>;
}

const getEmailContent = (notification: UnifiedNotification) => {
  const metadata = notification.notification_metadata;
  return metadata.tag === 'new_email' ? metadata.content : undefined;
};

const getStandaloneChannelMessageContent = (
  notification: UnifiedNotification
) => {
  const metadata = notification.notification_metadata;
  return metadata.tag === 'channel_message_send' ||
    metadata.tag === 'channel_mention'
    ? metadata.content
    : undefined;
};

const getStandaloneChannelMessageSenderFallback = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;
  return metadata.tag === 'channel_message_send'
    ? metadata.content.sender
    : (notification.sender_id ?? undefined);
};

function getNotificationSenderName(notification: UnifiedNotification): string {
  const email = getEmailContent(notification);
  const sender = email?.sender || notification.sender_id || 'Email';
  return sender.split('@')[0] || sender;
}

const getInitials = (value: string): string => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.[0] ?? '?').toUpperCase();
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
  const senderName = () => {
    if (email()) return getNotificationSenderName(props.notification);
    return displayName() || getNotificationSenderName(props.notification);
  };

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
    <div class="relative z-1 bg-surface">
      <div
        class="group/notif @container/notif-row flex items-center gap-2 px-2 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden cursor-pointer"
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
        <NotificationListIcon
          notification={props.notification}
          class="size-4.5 shrink-0"
        />
        <span
          class={cn('ph-no-capture truncate min-w-0 text-xs text-ink', {
            'font-medium': unread(),
          })}
        >
          <NotificationListDescription notification={props.notification} />
        </span>
        <span class="hidden @md/notif-row:flex flex-1 min-w-0 ph-no-capture truncate text-xs text-ink-extra-muted">
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
          <span class="text-xs text-right text-ink-extra-muted font-medium opacity-0 transition-opacity group-hover/notif:opacity-100">
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
        props.stacked ? 'w-full' : 'soup-list-entity w-full py-0.5',
        props.highlighted && 'ring ring-edge bg-active/60 ring-inset'
      )}
    >
      <Show
        when={hasCollapsedItems()}
        fallback={
          <Show
            when={getEmailContent(props.notification)}
            fallback={
              <div class="relative z-1 bg-surface">
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
        <div class="ml-12 mr-2 mt-1 rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden">
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

function ChannelMessageContentPreview(props: { content?: string }) {
  return (
    <Show when={props.content?.trim()}>
      {(content) => (
        <StaticMarkdown
          markdown={content()}
          theme={unifiedListMarkdownTheme}
          singleLine
        />
      )}
    </Show>
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

function EmailNotificationMessageLayout(props: {
  notification: UnifiedNotification;
}) {
  const email = () => getEmailContent(props.notification);
  const senderId = () => props.notification.sender_id ?? undefined;
  const senderMacroId = () =>
    senderId() ? tryMacroId(senderId() ?? '') : undefined;
  const [senderDisplayName] = useDisplayName(senderMacroId());
  const senderLabel = () =>
    senderDisplayName() || getNotificationSenderName(props.notification);

  return (
    <NotificationMessageLayout
      notification={props.notification}
      action={
        <>
          <NotificationListDescription notification={props.notification} /> sent
          an email
        </>
      }
      actionIcon={
        <NotificationListIcon
          notification={props.notification}
          class="size-3 text-current"
        />
      }
      icon={
        <Show
          when={senderMacroId()}
          fallback={
            <Avatar size="fill">
              <Avatar.Fallback class="font-semibold">
                {getInitials(senderLabel())}
              </Avatar.Fallback>
            </Avatar>
          }
        >
          {(id) => <UserIcon id={id()} size="fill" suppressClick showTooltip />}
        </Show>
      }
      title={email()?.subject || 'Email'}
      description={
        <Show when={email()?.snippet}>{(snippet) => snippet()}</Show>
      }
    />
  );
}

function GenericNotificationMessageLayout(props: {
  notification: UnifiedNotification;
}) {
  const senderId = () => props.notification.sender_id ?? undefined;
  const senderMacroId = () =>
    senderId() ? tryMacroId(senderId() ?? '') : undefined;
  const [senderDisplayName] = useDisplayName(senderMacroId());
  const senderLabel = () => senderDisplayName() || senderId() || 'Macro';
  const isAiResponse = () =>
    props.notification.notification_metadata.tag === 'ai_response';
  const isTaskAssigned = () =>
    props.notification.notification_metadata.tag === 'task_assigned';

  const genericIcon = () => (
    <Show
      when={isTaskAssigned()}
      fallback={
        <span class="grid size-8 place-items-center rounded-full bg-ink-muted/6 ring ring-ink-muted/8">
          <Show
            when={!isAiResponse() && senderMacroId()}
            fallback={
              <Show
                when={isAiResponse()}
                fallback={
                  <Avatar size="fill">
                    <Avatar.Fallback class="font-semibold">
                      {getInitials(senderLabel())}
                    </Avatar.Fallback>
                  </Avatar>
                }
              >
                <LogoIcon class="size-5 text-accent" />
              </Show>
            }
          >
            {(id) => (
              <UserIcon id={id()} size="fill" suppressClick showTooltip />
            )}
          </Show>
        </span>
      }
    >
      <Show
        when={senderMacroId()}
        fallback={
          <Avatar size="fill">
            <Avatar.Fallback class="font-semibold">
              {getInitials(senderLabel())}
            </Avatar.Fallback>
          </Avatar>
        }
      >
        {(id) => <UserIcon id={id()} size="fill" suppressClick showTooltip />}
      </Show>
    </Show>
  );

  return (
    <NotificationMessageLayout
      notification={props.notification}
      action={<NotificationListDescription notification={props.notification} />}
      actionIcon={
        <NotificationListIcon
          notification={props.notification}
          class="size-3.5 text-current"
        />
      }
      icon={genericIcon()}
      title={<NotificationContentPreview notification={props.notification} />}
    />
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
  const channelMessage = () =>
    getStandaloneChannelMessageContent(props.notification);
  const channelMessageSenderId = () =>
    props.notification.sender_id ??
    getStandaloneChannelMessageSenderFallback(props.notification);
  const channelMessageSenderMacroId = () =>
    channelMessageSenderId()
      ? tryMacroId(channelMessageSenderId() ?? '')
      : undefined;
  const [channelMessageSenderDisplayName] = useDisplayName(
    channelMessageSenderMacroId()
  );
  const channelMessageSenderName = () =>
    channelMessageSenderDisplayName() ||
    getStandaloneChannelMessageSenderFallback(props.notification) ||
    'Unknown';
  const isDirectMessage = () =>
    channelMessage()?.channelType === 'directMessage';

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

  if (channelMessage() && !props.isStack) {
    return (
      <ChannelNotificationMessageLayout notification={props.notification} />
    );
  }

  if (getEmailContent(props.notification) && !props.isStack) {
    return <EmailNotificationMessageLayout notification={props.notification} />;
  }

  if (!getEmailContent(props.notification) && !props.isStack) {
    return (
      <GenericNotificationMessageLayout notification={props.notification} />
    );
  }

  return (
    <div class="relative z-1 bg-surface">
      <div
        class="group/notif grid min-w-0 cursor-pointer grid-cols-[1rem_1rem_minmax(0,1fr)_4rem] grid-rows-[auto_auto_auto] gap-x-1.5 gap-y-0.5 overflow-hidden rounded-lg px-2 py-2 hover:bg-ink-muted/6"
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
        <span class="col-start-2 row-start-1 grid size-4 place-items-center self-center">
          <Show
            when={props.isStack}
            fallback={
              <NotificationListIcon
                notification={props.notification}
                class="size-4.5"
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
        <div class="col-start-3 row-start-1 min-w-0 flex items-center gap-1.5 pl-1">
          <span
            class={cn('ph-no-capture truncate min-w-0 text-xs text-ink', {
              'font-medium': unread(),
            })}
          >
            <Show
              when={channelMessage()}
              fallback={
                <NotificationListDescription
                  notification={props.notification}
                />
              }
            >
              {(content) =>
                isDirectMessage()
                  ? channelMessageSenderName()
                  : (content().channelName ?? 'Channel')
              }
            </Show>
          </span>
        </div>
        <span class="col-start-4 row-start-1 justify-self-end text-xs text-right text-ink-extra-muted font-medium opacity-0 transition-opacity group-hover/notif:opacity-100 opacity-0 transition-opacity group-hover/notif:opacity-100">
          <NotificationListTimestamp notification={props.notification} />
        </span>
        <Show
          when={channelMessage()}
          fallback={
            <Show
              when={getEmailContent(props.notification)}
              fallback={
                <div class="col-start-3 col-span-2 row-start-2 min-h-3 min-w-0 ph-no-capture truncate pl-1 text-[11px] leading-3 text-ink-extra-muted">
                  <NotificationContentPreview
                    notification={props.notification}
                  />
                </div>
              }
            >
              {(content) => (
                <>
                  <div class="col-start-3 col-span-2 row-start-2 min-h-3 min-w-0 ph-no-capture truncate pl-1 text-[11px] leading-3 text-ink-muted">
                    {content().subject}
                  </div>
                  <Show when={content().snippet}>
                    {(snippet) => (
                      <div class="col-start-3 col-span-2 row-start-3 min-w-0 ph-no-capture truncate pl-1 text-xs text-ink-extra-muted">
                        {snippet()}
                      </div>
                    )}
                  </Show>
                </>
              )}
            </Show>
          }
        >
          {(content) => (
            <Show
              when={isDirectMessage()}
              fallback={
                <>
                  <div class="col-start-3 col-span-2 row-start-2 min-h-3 min-w-0 ph-no-capture truncate pl-1 text-[11px] leading-3 text-ink-muted">
                    {channelMessageSenderName()}
                  </div>
                  <Show when={content().messageContent}>
                    {(messageContent) => (
                      <div class="col-start-3 col-span-2 row-start-3 min-w-0 ph-no-capture truncate pl-1 text-xs text-ink-extra-muted">
                        <ChannelMessageContentPreview
                          content={messageContent()}
                        />
                      </div>
                    )}
                  </Show>
                </>
              }
            >
              <Show when={content().messageContent}>
                {(messageContent) => (
                  <div class="col-start-3 col-span-2 row-start-2 min-h-3 min-w-0 ph-no-capture truncate pl-1 text-[11px] leading-3 text-ink-extra-muted">
                    <ChannelMessageContentPreview content={messageContent()} />
                  </div>
                )}
              </Show>
            </Show>
          )}
        </Show>
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
        props.stacked ? 'w-full' : 'soup-list-entity w-full py-0.5',
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
        <div class="ml-12 mr-2 mt-1 rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden">
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
      class="relative z-1 bg-surface"
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          toggle(e);
        }
      }}
    >
      <div class="group/notif flex items-center gap-2 px-2 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden cursor-pointer">
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
        <span class="hidden @md/notif-row:flex flex-1 min-w-0 ph-no-capture truncate text-xs text-ink-extra-muted">
          <Entity.Notification.Content
            notification={props.notification}
            singleLine
          />
        </span>
        <div class="shrink-0 ml-auto h-5 flex items-center justify-end">
          <span
            class={cn(
              'text-xs text-right text-ink-extra-muted font-medium opacity-0 transition-opacity group-hover/notif:opacity-100',
              {
                'group-hover/notif:hidden': canMarkDone(),
              }
            )}
          >
            <NotificationListTimestamp notification={props.notification} />
          </span>
        </div>
      </div>
    </div>
  );
}

const GITHUB_GRID_TEMPLATE_COLUMNS =
  '1rem minmax(0, 1fr) var(--github-col-author, 8rem) var(--github-col-link, 12rem) var(--github-col-timestamp, 4rem)';
const GITHUB_GRID_TEMPLATE_AREAS = '"indicator content author link timestamp"';

export function GithubNotificationListHeader(props: { class?: string }) {
  return (
    <div
      class={cn(
        'github-grid-row w-full grid items-center gap-2 px-3 h-10',
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
  const status = () => props.status ?? github()?.status;
  const url = () => props.url ?? github()?.url;
  const prNumber = () => {
    const number = github()?.number;
    return typeof number === 'number' ? `#${number}` : undefined;
  };
  const authorId = () =>
    props.authorId ?? props.notification.sender_id ?? undefined;
  const authorFallback = () =>
    props.authorFallback ?? github()?.senderGithubLogin ?? undefined;
  const authorMacroId = () =>
    authorId() ? tryMacroId(authorId() ?? '') : undefined;
  const [authorDisplayName] = useDisplayName(authorMacroId());
  const authorLabel = () =>
    authorDisplayName() || authorFallback() || authorId() || undefined;
  const githubActionLabel = () => {
    const content = github();
    if (!content) return 'updated';
    if (content.status === 'merged') return 'merged';
    if (content.action === 'closed' || content.status === 'closed')
      return 'closed';
    if (content.action === 'opened' || content.action === 'reopened') {
      return 'opened';
    }
    return content.action;
  };
  const githubActionText = () =>
    `${authorLabel() ?? 'Someone'} ${githubActionLabel()} PR`;
  const openGithubUrl = (e: MouseEvent) => {
    e.stopPropagation();
    const href = url();
    if (!href) return;
    window.open(href, '_blank', 'noreferrer');
  };
  const githubDescription = () => {
    const content = github();
    if (!content) return undefined;

    const date = new Date(
      content.status === 'merged' && content.mergedAt
        ? content.mergedAt
        : (props.notification.created_at ?? props.notification.updated_at ?? 0)
    );
    const timing = `${githubActionLabel()} ${formatDistanceToNowStrict(date, {
      addSuffix: true,
    })}`;

    return `${content.owner}/${content.repo} · ${timing}`;
  };
  return (
    <Show
      when={github()}
      fallback={
        <NotificationListEntity notification={props.notification} stacked />
      }
    >
      <NotificationMessageLayout
        notification={props.notification}
        action={
          <>
            {githubActionText()}
            <Show when={prNumber()}>
              {(number) => (
                <button
                  type="button"
                  class="ml-1 shrink-0 text-ink-muted underline decoration-ink-muted/30 underline-offset-2 hover:text-ink"
                  onClick={openGithubUrl}
                >
                  {number()}
                </button>
              )}
            </Show>
          </>
        }
        actionIcon={
          <Show
            when={status()}
            fallback={<GithubIcon class="size-3.5 shrink-0" />}
          >
            {(value) => {
              const StatusIcon = getGithubStatusIcon(value());
              return (
                <StatusIcon
                  class={cn('size-3.5 shrink-0', getGithubStatusClass(value()))}
                />
              );
            }}
          </Show>
        }
        icon={
          <Show
            when={authorMacroId() && authorId()}
            fallback={
              <Avatar size="fill">
                <Avatar.Fallback class="font-semibold">
                  {getInitials(authorLabel() ?? authorFallback() ?? 'GitHub')}
                </Avatar.Fallback>
              </Avatar>
            }
          >
            {(id) => (
              <UserIcon id={id()} size="fill" suppressClick showTooltip />
            )}
          </Show>
        }
        title={
          <span
            class={cn('min-w-0 truncate', {
              'font-semibold': unread(),
            })}
          >
            {title()}
          </span>
        }
        description={
          <Show when={githubDescription()}>
            {(description) => description()}
          </Show>
        }
      />
    </Show>
  );
}
