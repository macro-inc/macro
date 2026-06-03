import './NotificationListEntity.css';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import { Entity, formatRelativeTimestamp, NotificationRow } from '@entity';
import GithubIcon from '@icon/mcp-github.svg';
import type { UnifiedNotification } from '@notifications';
import { Avatar, Button, cn } from '@ui';
import { createEffect, createSignal, For, Show } from 'solid-js';

interface NotificationListEntityProps {
  notification: UnifiedNotification;
  highlighted?: boolean;
  stacked?: boolean;
  collapsedCount?: number;
  collapsedNotifications?: UnifiedNotification[];
}

export function NotificationListEntity(props: NotificationListEntityProps) {
  const collapsedCount = () => props.collapsedCount ?? 1;
  const hasCollapsedItems = () => collapsedCount() > 1;
  const [expanded, setExpanded] = createSignal(false);
  const collapsedNotifications = () => props.collapsedNotifications ?? [];

  return (
    <div
      class={cn(
        '@container/entity relative group/narrow flex flex-col min-h-10',
        props.stacked
          ? 'w-full'
          : 'soup-list-entity rounded-lg w-[calc(100%-0.5rem)] mr-1 py-0.5 mx-1',
        props.highlighted && 'ring ring-edge bg-active/60 ring-inset'
      )}
    >
      <Show
        when={hasCollapsedItems()}
        fallback={
          <div class="relative z-1 bg-surface rounded-lg shadow-[0_1px_0_rgb(from_var(--color-ink)_r_g_b_/_0.04)]">
            <NotificationRow
              notification={props.notification}
              variant="compact"
              class={cn(!props.stacked && 'rounded-lg')}
            />
          </div>
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
          <For each={collapsedNotifications().slice(1)}>
            {(notification) => (
              <NotificationRow notification={notification} variant="compact" />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function StackedNotificationIcon(props: {
  notification: UnifiedNotification;
  count: number;
  reloading?: boolean;
}) {
  const visibleCount = () => Math.min(props.count, 3);
  const topY = () => (visibleCount() >= 3 ? 2 : visibleCount() === 2 ? 5 : 8);
  const iconTopClass = () => {
    if (visibleCount() >= 3) return 'top-[33%]';
    if (visibleCount() === 2) return 'top-[46%]';
    return 'top-[58%]';
  };

  return (
    <span class="relative block size-6 shrink-0 text-ink-muted">
      <svg
        viewBox="0 0 24 24"
        class="absolute inset-0 size-full text-ink-muted/70"
        aria-hidden="true"
      >
        <Show when={props.count > 3}>
          <rect
            x="5"
            y="8"
            width="14"
            height="12"
            rx="2"
            class={cn(
              'notification-stack-svg-piece fill-ink-muted/5 stroke-current opacity-0',
              props.reloading && 'notification-stack-card-in'
            )}
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </Show>
        <Show when={visibleCount() >= 3}>
          <rect
            x="5"
            y="8"
            width="14"
            height="12"
            rx="2"
            class={cn(
              'notification-stack-svg-piece fill-ink-muted/5 stroke-current',
              props.reloading &&
                props.count > 3 &&
                'notification-stack-card-shift'
            )}
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </Show>
        <Show when={visibleCount() >= 2}>
          <rect
            x="5"
            y="5"
            width="14"
            height="12"
            rx="2"
            class={cn(
              'notification-stack-svg-piece fill-ink-muted/5 stroke-current',
              props.reloading &&
                props.count > 3 &&
                'notification-stack-card-shift'
            )}
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </Show>
        <g
          class={cn(
            'notification-stack-svg-piece',
            props.reloading && 'notification-stack-card-out'
          )}
        >
          <rect
            x="5"
            y={topY()}
            width="14"
            height="12"
            rx="2"
            class="fill-surface stroke-current"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </g>
      </svg>
      <span
        class={cn(
          'absolute left-1/2 -translate-x-1/2 -translate-y-1/2',
          iconTopClass(),
          props.reloading && 'notification-stack-icon-out'
        )}
      >
        <Entity.Notification.Icon
          notification={props.notification}
          class="size-3"
        />
      </span>
    </span>
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
      class="relative z-1 bg-surface rounded-lg shadow-[0_1px_0_rgb(from_var(--color-ink)_r_g_b_/_0.04)]"
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          toggle(e);
        }
      }}
    >
      <div class="group/notif flex items-center gap-2.5 px-3 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden cursor-pointer rounded-lg">
        <span
          class={cn('size-1.5 rounded-full shrink-0', {
            'bg-accent': unread(),
            'bg-transparent': !unread(),
          })}
        />
        <button
          type="button"
          class="relative shrink-0 size-7 grid place-items-center rounded-md hover:bg-ink-muted/6 outline-none focus-visible:bg-active"
          title={props.expanded ? 'Collapse messages' : 'Expand messages'}
          onClick={toggle}
        >
          <StackedNotificationIcon
            notification={props.notification}
            count={props.count}
            reloading={reloading()}
          />
          <span class="absolute -left-1 -top-1 rounded-full border border-edge-muted bg-surface px-1 py-px text-[10px] leading-none font-medium text-ink-extra-muted tabular-nums">
            {props.count}
          </span>
        </button>
        <span
          class={cn('ph-no-capture truncate min-w-0 text-xs text-ink', {
            'font-medium': unread(),
          })}
        >
          <Entity.Notification.Description notification={props.notification} />
        </span>
        <span class="hidden @md/notif-row:flex flex-1 min-w-0 ph-no-capture truncate text-xs text-ink-muted/60">
          <Entity.Notification.Content
            notification={props.notification}
            singleLine
          />
        </span>
        <div class="shrink-0 ml-auto h-5 flex items-center justify-end">
          <span
            class={cn('text-ink-extra-muted text-xs tabular-nums', {
              'group-hover/notif:hidden': canMarkDone(),
            })}
          >
            <Entity.Notification.Timestamp notification={props.notification} />
          </span>
        </div>
      </div>
    </div>
  );
}

const GITHUB_GRID_TEMPLATE = '1fr minmax(7rem, 10rem) minmax(5rem, 7rem) 2rem';

export function GithubNotificationListHeader() {
  return (
    <div
      class="w-full grid items-center gap-2 px-3 h-8 text-xs font-medium text-ink-extra-muted bg-surface"
      style={{ 'grid-template-columns': GITHUB_GRID_TEMPLATE }}
    >
      <div class="truncate">Update</div>
      <div class="truncate">Author</div>
      <div class="truncate text-right">Updated</div>
      <div />
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
    <div class="min-w-0 flex items-center gap-1 text-xs text-ink-muted">
      <Show
        when={macroId() && props.id}
        fallback={
          <Avatar size="sm" class="size-4">
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
  );
}

const getGithubUpdateText = (notification: UnifiedNotification): string => {
  const metadata = notification.notification_metadata;
  if (metadata.tag !== 'github_pr_event') return '';
  return metadata.content.action;
};

const getGithubContent = (notification: UnifiedNotification) => {
  const metadata = notification.notification_metadata;
  return metadata.tag === 'github_pr_event' ? metadata.content : undefined;
};

export function GithubNotificationListEntity(props: {
  notification: UnifiedNotification;
}) {
  const github = () => getGithubContent(props.notification);
  const unread = () =>
    !props.notification.viewed_at && !props.notification.done;
  const timestamp = () =>
    formatRelativeTimestamp(
      props.notification.created_at ??
        props.notification.updated_at ??
        new Date(0),
      { condensed: true }
    );

  return (
    <Show
      when={github()}
      fallback={
        <NotificationListEntity notification={props.notification} stacked />
      }
    >
      {(content) => (
        <div
          class="group/notif grid items-center gap-2 px-3 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden"
          style={{ 'grid-template-columns': GITHUB_GRID_TEMPLATE }}
        >
          <div class="min-w-0 flex items-center gap-2">
            <span
              class={cn('size-1.5 rounded-full shrink-0', {
                'bg-accent': unread(),
                'bg-transparent': !unread(),
              })}
            />
            <span
              class={cn('truncate min-w-0 text-xs text-ink', {
                'font-medium': unread(),
              })}
            >
              {getGithubUpdateText(props.notification)}
            </span>
            <span class="truncate min-w-0 text-xs text-ink-muted/60">
              {content().displayName}
            </span>
          </div>
          <NotificationAuthor
            id={props.notification.sender_id ?? undefined}
            fallback={content().senderGithubLogin ?? undefined}
          />
          <span class="shrink-0 text-ink-extra-muted text-xs tabular-nums text-right">
            {timestamp()}
          </span>
          <Show when={content().url} fallback={<div />}>
            {(url) => (
              <Button
                variant="ghost"
                size="icon-sm"
                class="justify-self-end text-ink-muted !size-5 !p-0"
                noTouchResize
                tooltip="Open pull request"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(url(), '_blank', 'noreferrer');
                }}
              >
                <GithubIcon class="size-2.5" />
              </Button>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
