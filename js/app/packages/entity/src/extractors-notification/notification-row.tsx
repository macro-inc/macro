import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ContextMenuContent, MenuItem } from '@core/component/Menu';
import { toast } from '@core/component/Toast/Toast';
import type { NotificationType } from '@core/types';
import { buildSimpleEntityUrl } from '@core/util/url';
import CheckIcon from '@icon/regular/check.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import {
  getChannelNotificationParams,
  openNotification,
  type UnifiedNotification,
} from '@notifications';
import { Button, cn } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { Layout } from '../core/Layout';
import { Slot } from '../core/Slot';
import type { EntityData } from '../types/entity';
import { isNotificationUnread } from '../utils/notification';
import { useNotificationActions } from './notification-actions';
import { DocumentMentionPill, NotificationContent } from './notification-content';
import { NotificationDescription } from './notification-description';
import { NotificationIcon } from './notification-icon';
import { NotificationSenderIcon } from './notification-sender-icon';
import { NotificationTimestamp } from './notification-timestamp';

function getNotificationUrl(notification: UnifiedNotification): string {
  const { params } = getChannelNotificationParams(notification);
  return buildSimpleEntityUrl(
    { type: notification.entity_type, id: notification.entity_id },
    params
  );
}

/**
 * Per-type content renderer for a single, unstacked notification.
 *
 * Mirrors `NotificationContent` for the stacked case but specializes a few
 * types that benefit from non-text layouts (document mentions become a pill,
 * email gets subject + snippet, task assignment gets the task name).
 */
function NotificationRowContent(props: {
  notification: UnifiedNotification;
  singleLine?: boolean;
}) {
  const tag = (): NotificationType => props.notification.notification_metadata.tag;

  return (
    <Switch
      fallback={
        <NotificationContent
          notification={props.notification}
          singleLine={props.singleLine}
        />
      }
    >
      <Match when={tag() === 'document_mention'}>
        <div class="pt-1">
          <DocumentMentionPill notification={props.notification} />
        </div>
      </Match>
      <Match
        when={(() => {
          const m = props.notification.notification_metadata;
          return m.tag === 'new_email' ? m.content : undefined;
        })()}
      >
        {(content) => (
          <span class="ph-no-capture truncate min-w-0 text-xs text-ink-muted/80">
            <span class="text-ink">{content().subject}</span>
            <Show when={content().snippet}>
              <span class="text-ink-extra-muted"> — {content().snippet}</span>
            </Show>
          </span>
        )}
      </Match>
      <Match
        when={(() => {
          const m = props.notification.notification_metadata;
          return m.tag === 'task_assigned' ? m.content.taskName : undefined;
        })()}
      >
        {(taskName) => (
          <span class="ph-no-capture truncate min-w-0 text-xs text-ink">
            {taskName()}
          </span>
        )}
      </Match>
      <Match when={tag() === 'channel_invite'}>
        <span class="text-xs text-ink-muted/80 italic">
          to join the channel
        </span>
      </Match>
      <Match when={tag() === 'invite_to_team'}>
        <span class="text-xs text-ink-muted/80 italic">to join the team</span>
      </Match>
      <Match when={tag() === 'call-started'}>
        <span class="text-xs text-ink-muted/80 italic">
          started a call you can join
        </span>
      </Match>
    </Switch>
  );
}

export interface NotificationRowProps {
  notification: UnifiedNotification;
  entity?: EntityData;
  onClick?: (e: PointerEvent | MouseEvent | KeyboardEvent) => void;
  /** Override the content slot (e.g. to show a fully custom body). */
  content?: JSX.Element;
  /** Whether the "Mark done" affordance is available. Defaults to true except for `call-started`. */
  showMarkDone?: boolean;
  class?: string;
}

/**
 * A single, unstacked notification row.
 *
 * Visual structure mirrors `NotificationStackRow` but takes one notification,
 * uses the type-polymorphic notification extractors, and lets per-type content
 * render through a `Switch` inside the content slot — the same shape used by
 * the entity list-item layouts.
 */
export function NotificationRow(props: NotificationRowProps) {
  const notificationSource = useGlobalNotificationSource();
  const unread = () => isNotificationUnread(props.notification);
  const canMarkDone = () =>
    props.showMarkDone !== false &&
    (props.notification.notification_metadata.tag as NotificationType) !==
      'call-started';

  const { markAsDone, markAsRead } = useNotificationActions({
    notification: props.notification,
  });

  const handleClick = async (
    e: PointerEvent | MouseEvent | KeyboardEvent
  ) => {
    const splitManager = globalSplitManager();
    if (!splitManager) return;

    e.stopPropagation();
    const entity = props.entity;
    const entityOverride = {
      fileType: entity && 'fileType' in entity ? entity.fileType : undefined,
      subType: entity && 'subType' in entity ? entity.subType : undefined,
    };
    await openNotification(
      props.notification,
      splitManager,
      e.shiftKey,
      entityOverride
    );
    await notificationSource.markAsRead(props.notification);
    props.onClick?.(e);
  };

  const handleMarkAsDone = (e?: PointerEvent | MouseEvent) => {
    e?.stopPropagation();
    markAsDone();
  };

  const handleMarkAsRead = async () => {
    await markAsRead();
  };

  const handleCopyLink = async () => {
    const url = getNotificationUrl(props.notification);
    await navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  };

  return (
    <ContextMenu>
      <ContextMenu.Trigger class="size-full">
        <Layout
          class={cn(
            'group/notif grid items-center gap-2.5 px-3 py-2 hover:bg-ink-muted/[0.06] min-w-0 overflow-hidden cursor-pointer',
            'grid-cols-[auto_auto_auto_auto_minmax(0,1fr)_auto]',
            props.class
          )}
          onClick={handleClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleClick(e);
            }
            if (e.key === 'e' && canMarkDone()) {
              e.preventDefault();
              e.stopPropagation();
              handleMarkAsDone();
            }
          }}
        >
          <Slot placement="indicator" class="flex items-center">
            <span
              class={cn('size-1.5 rounded-full shrink-0', {
                'bg-accent': unread(),
                'bg-transparent': !unread(),
              })}
            />
          </Slot>
          <Slot placement="icon" class="flex items-center">
            <NotificationIcon
              notification={props.notification}
              class="size-3.5 shrink-0 text-ink-muted/60"
            />
          </Slot>
          <Slot placement="sender" class="shrink-0 flex items-center">
            <NotificationSenderIcon
              notification={props.notification}
              size="sm"
            />
          </Slot>
          <Slot
            placement="description"
            class={cn(
              'ph-no-capture truncate min-w-0 text-xs text-ink',
              unread() && 'font-medium'
            )}
          >
            <NotificationDescription notification={props.notification} />
          </Slot>
          <Slot
            placement="content"
            class="ph-no-capture truncate min-w-0 text-xs text-ink-muted/60 flex items-center"
          >
            {props.content ?? (
              <NotificationRowContent
                notification={props.notification}
                singleLine
              />
            )}
          </Slot>
          <Slot placement="actions" class="shrink-0 ml-auto">
            <span
              class={cn('text-ink-extra-muted text-xs tabular-nums', {
                'group-hover/notif:hidden': canMarkDone(),
              })}
            >
              <NotificationTimestamp notification={props.notification} />
            </span>
            <Show when={canMarkDone()}>
              <Button
                onClick={handleMarkAsDone}
                tooltip="Mark done"
                class="rounded text-ink-muted hover:text-accent hover:bg-accent/10 hidden group-hover/notif:grid p-0 place-items-center size-5"
              >
                <CheckIcon class="size-3" />
              </Button>
            </Show>
          </Slot>
        </Layout>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <div onClick={(e) => e.stopPropagation()}>
          <ContextMenuContent class="text-xs text-ink-muted">
            <Show when={canMarkDone()}>
              <MenuItem text="Mark Done" onClick={() => handleMarkAsDone()} />
            </Show>
            <MenuItem text="Mark Read" onClick={handleMarkAsRead} />
            <MenuItem text="Copy Link" onClick={handleCopyLink} />
          </ContextMenuContent>
        </div>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
