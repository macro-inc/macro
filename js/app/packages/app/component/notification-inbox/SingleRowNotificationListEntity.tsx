import './NotificationListEntity.css';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import { Entity } from '@entity';
import GithubIcon from '@icon/mcp-github.svg';
import { openNotification, type UnifiedNotification } from '@notifications';
import GitMergeIcon from '@phosphor-icons/core/regular/git-merge.svg?component-solid';
import GitPullRequestIcon from '@phosphor-icons/core/regular/git-pull-request.svg?component-solid';
import XCircleIcon from '@phosphor-icons/core/regular/x-circle.svg?component-solid';
import type { GithubPrEventStatus } from '@service-notification/generated/schemas';
import { Avatar, Button, cn, Tooltip } from '@ui';
import { format } from 'date-fns';
import { Show } from 'solid-js';
import { NotificationListIcon } from './NotificationListIcon';

interface SingleRowNotificationListEntityProps {
  notification: UnifiedNotification;
  highlighted?: boolean;
  checked?: boolean;
  stacked?: boolean;
  title?: string;
  subtitle?: string;
  status?: GithubPrEventStatus;
  url?: string;
  authorId?: string;
  authorFallback?: string;
  onClick?: (e: MouseEvent) => void;
  onMouseMove?: (e: MouseEvent) => void;
}

const getNotificationDate = (notification: UnifiedNotification): Date =>
  new Date(notification.created_at ?? notification.updated_at ?? 0);

type GithubNotificationMetadata = Extract<
  UnifiedNotification['notification_metadata'],
  {
    tag:
      | 'github_pr_status_changed'
      | 'github_review_requested'
      | 'github_pr_comment'
      | 'github_pr_mention'
      | 'github_pr_review';
  }
>;

type GithubNotificationContent = GithubNotificationMetadata['content'];

const isGithubNotificationMetadata = (
  metadata: UnifiedNotification['notification_metadata']
): metadata is GithubNotificationMetadata => {
  switch (metadata.tag) {
    case 'github_pr_status_changed':
    case 'github_review_requested':
    case 'github_pr_comment':
    case 'github_pr_mention':
    case 'github_pr_review':
      return true;
    default:
      return false;
  }
};

const getGithubContent = (
  notification: UnifiedNotification
): GithubNotificationContent | undefined => {
  const metadata = notification.notification_metadata;
  return isGithubNotificationMetadata(metadata) ? metadata.content : undefined;
};

const getEmailContent = (notification: UnifiedNotification) => {
  const metadata = notification.notification_metadata;
  return metadata.tag === 'new_email' ? metadata.content : undefined;
};

const getInviteTarget = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_invite':
      return metadata.content.channelName;
    case 'invite_to_team':
      return metadata.content.teamName;
    default:
      return undefined;
  }
};

const getSenderFallback = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  if (metadata.tag === 'new_email') {
    const sender = metadata.content.sender ?? undefined;
    return sender ? sender.split('@')[0] || sender : undefined;
  }

  if (metadata.tag === 'channel_message_send') {
    return metadata.content.sender ?? undefined;
  }
  if (metadata.tag === 'channel_message_reply') {
    return metadata.content.userId ?? undefined;
  }

  return notification.sender_id ?? undefined;
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
    <Show
      when={macroId() && props.id}
      fallback={
        <Tooltip label={label()} as="span">
          <span class="flex h-full min-w-0 items-center gap-1 text-xs leading-none text-ink-muted">
            <Avatar size="sm" class="size-4">
              <Avatar.Fallback class="font-semibold">
                {getInitials(label())}
              </Avatar.Fallback>
            </Avatar>
            <span class="truncate leading-none">{label()}</span>
          </span>
        </Tooltip>
      }
    >
      {(id) => (
        <span class="flex h-full min-w-0 items-center gap-1 text-xs leading-none text-ink-muted">
          <UserIcon id={id()} size="sm" suppressClick showTooltip />
          <span class="truncate leading-none">{label()}</span>
        </span>
      )}
    </Show>
  );
}

function CollapsedGithubLinkPill(props: { url?: string; label?: string }) {
  const label = () => props.label ?? 'Open pull request';

  return (
    <Show
      when={props.url}
      fallback={
        <span
          class="inline-grid size-6 shrink-0 place-items-center rounded-full border border-edge-muted text-ink-muted"
          title={label()}
          aria-label={label()}
        >
          <GithubIcon class="size-3.5" />
        </span>
      }
    >
      {(url) => (
        <Button
          variant="ghost"
          size="sm"
          class="[&_:where(svg)]:size-3.5 size-6 shrink-0 rounded-full border border-edge-muted bg-surface p-0 text-ink-muted"
          noTouchResize
          tooltip={label()}
          aria-label={label()}
          onClick={(e) => {
            e.stopPropagation();
            window.open(url(), '_blank', 'noreferrer');
          }}
        >
          <GithubIcon />
        </Button>
      )}
    </Show>
  );
}

export function SingleRowNotificationListEntity(
  props: SingleRowNotificationListEntityProps
) {
  const notificationSource = useGlobalNotificationSource();
  const github = () => getGithubContent(props.notification);
  const email = () => getEmailContent(props.notification);
  const inviteTarget = () => getInviteTarget(props.notification);
  const senderMacroId = () =>
    props.notification.sender_id
      ? tryMacroId(props.notification.sender_id)
      : undefined;
  const [senderDisplayName] = useDisplayName(senderMacroId());
  const senderLabel = () =>
    senderDisplayName() || getSenderFallback(props.notification) || 'Unknown';
  const unread = () =>
    !props.notification.viewed_at && !props.notification.done;
  const title = () => {
    const content = github();
    if (!content) return props.title ?? '';
    if (props.title) return props.title;
    return 'action' in content ? content.action : content.title;
  };
  const description = () => (props.title ? undefined : github()?.displayName);
  const status = () => {
    const content = github();
    return (
      props.status ??
      (content && 'status' in content ? content.status : undefined)
    );
  };
  const url = () => props.url ?? github()?.url;
  const subtitle = () => props.subtitle ?? github()?.githubKey;
  const linkLabel = () => {
    const content = github();
    return content ? `${content.owner}/${content.repo}` : subtitle();
  };
  const authorId = () =>
    props.authorId ?? props.notification.sender_id ?? undefined;
  const authorFallback = () =>
    props.authorFallback ?? github()?.senderGithubLogin ?? undefined;
  const timestamp = () =>
    format(getNotificationDate(props.notification), 'h:mm a');

  const handleOpen = async (e: MouseEvent | KeyboardEvent) => {
    props.onClick?.(e as MouseEvent);
    const splitManager = globalSplitManager();
    if (!splitManager) return;
    await openNotification(props.notification, splitManager, e.shiftKey);
    await notificationSource.markAsRead(props.notification);
  };

  return (
    <div
      class={cn(
        'soup-list-entity rounded-lg @container/entity w-[calc(100%-0.5rem)] mr-1 relative group/narrow flex flex-col py-0.5 min-h-10',
        {
          'bg-accent/8': props.checked,
          'ring ring-accent/16 ring-inset': props.checked && props.highlighted,
          'ring ring-edge bg-active/60 ring-inset':
            props.highlighted && !props.checked,
          'hover:bg-active/30': !props.highlighted && !props.checked,
        }
      )}
      onMouseMove={props.onMouseMove}
    >
      <div
        class="group/notif grid min-h-10 min-w-0 cursor-pointer grid-cols-[1rem_1rem_minmax(0,1fr)_minmax(0,8rem)_1.5rem_4rem] items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 hover:bg-ink-muted/6"
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
        <span class="grid size-4 place-items-center">
          <span
            class={cn('size-1.5 rounded-full', {
              'bg-accent': unread(),
              'bg-transparent': !unread(),
            })}
          />
        </span>
        <Show
          when={status()}
          fallback={
            <NotificationListIcon
              notification={props.notification}
              class="size-4.5 shrink-0"
            />
          }
        >
          {(value) => {
            const StatusIcon = getGithubStatusIcon(value());
            return (
              <StatusIcon
                class={cn('size-4.5 shrink-0', getGithubStatusClass(value()))}
              />
            );
          }}
        </Show>
        <Show
          when={github()}
          fallback={
            <div class="col-span-3 min-w-0 flex items-center gap-1.5 text-xs tracking-tight">
              <span
                class={cn(
                  'ph-no-capture shrink-0 whitespace-nowrap text-ink-muted',
                  {
                    'text-ink font-semibold': unread(),
                  }
                )}
              >
                <Show
                  when={email() || inviteTarget()}
                  fallback={
                    <Entity.Notification.Description
                      notification={props.notification}
                    />
                  }
                >
                  {senderLabel()}
                </Show>
              </span>
              <Show when={inviteTarget()}>
                <span class="shrink-0 whitespace-nowrap text-xs text-ink-muted/70">
                  invited you to
                </span>
              </Show>
              <span class="ph-no-capture truncate min-w-0 flex-1 text-xs font-normal text-ink-muted/60">
                <Show
                  when={email()}
                  fallback={
                    <Show
                      when={inviteTarget()}
                      fallback={
                        <Entity.Notification.Content
                          notification={props.notification}
                          singleLine
                        />
                      }
                    >
                      {(target) => (
                        <span class="font-medium text-ink-muted">
                          {target()}
                        </span>
                      )}
                    </Show>
                  }
                >
                  {(content) => (
                    <>
                      <span class="text-ink-muted">{content().subject}</span>
                      <Show when={content().snippet}>
                        {(snippet) => (
                          <span class="text-ink-extra-muted">
                            {' '}
                            — {snippet()}
                          </span>
                        )}
                      </Show>
                    </>
                  )}
                </Show>
              </span>
            </div>
          }
        >
          <div class="min-w-0 flex items-center gap-1.5 text-xs font-semibold tracking-tight">
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
          </div>
          <div class="hidden @md/entity:block min-w-0 overflow-hidden">
            <div class="inline-flex h-6 max-w-full min-w-0 items-center rounded-full border border-edge-muted px-1.5 py-0 text-xs leading-none overflow-hidden">
              <NotificationAuthor id={authorId()} fallback={authorFallback()} />
            </div>
          </div>
          <CollapsedGithubLinkPill url={url()} label={linkLabel()} />
        </Show>
        <span class="shrink-0 justify-self-end text-xs text-right text-ink-extra-muted font-medium">
          {timestamp()}
        </span>
      </div>
    </div>
  );
}
