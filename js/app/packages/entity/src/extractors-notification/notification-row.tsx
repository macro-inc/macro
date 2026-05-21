import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import type { NotificationType } from '@core/types';
import { buildSimpleEntityUrl } from '@core/util/url';
import { ContextMenu } from '@kobalte/core/context-menu';
import {
  getChannelNotificationParams,
  openNotification,
  type UnifiedNotification,
} from '@notifications';
import CheckIcon from '@phosphor/check.svg';
import { Button, cn } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { Layout } from '../core/Layout';
import type { EntityData } from '../types/entity';
import { isNotificationUnread } from '../utils/notification';
import { useNotificationActions } from './notification-actions';
import {
  DocumentMentionPill,
  NotificationContent,
} from './notification-content';
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
  const tag = (): NotificationType =>
    props.notification.notification_metadata.tag;

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

type NotificationRowVariant = 'compact' | 'expanded';

interface NotificationRowProps {
  notification: UnifiedNotification;
  entity?: EntityData;
  onClick?: (e: PointerEvent | MouseEvent | KeyboardEvent) => void;
  /** Override the content slot (e.g. to show a fully custom body). */
  content?: JSX.Element;
  /**
   * Whether the "Mark done" affordance is available. Defaults to true except
   * for `call-started`, which has no meaningful "done" state.
   */
  showMarkDone?: boolean;
  /**
   * Visual variant. Both variants share the same fonts, colors, icon sizes,
   * indicator, hover affordances, and mark-done behavior — they differ only
   * in how content is laid out.
   *
   * - `compact` (default): single line, content truncated to one line.
   *   Designed for dense lists (right-panel notifications card, soup).
   * - `expanded`: same one-line header with content below as multi-line
   *   markdown aligned under the description. For stand-alone display
   *   (bell popover, inbox detail, toast).
   */
  variant?: NotificationRowVariant;
  class?: string;
}

interface BodyProps {
  notification: UnifiedNotification;
  unread: boolean;
  canMarkDone: boolean;
  onMarkAsDone: () => void;
  contentOverride?: JSX.Element;
  class?: string;
}

// Shared building blocks — every variant renders the SAME indicator, icon,
// sender icon, description, timestamp, and mark-done button. The variants
// only differ in how those pieces are arranged on the page.

function UnreadDot(props: { unread: boolean }) {
  return (
    <span
      class={cn('size-1.5 rounded-full shrink-0', {
        'bg-accent': props.unread,
        'bg-transparent': !props.unread,
      })}
    />
  );
}

function HeaderLeading(props: {
  notification: UnifiedNotification;
  unread: boolean;
}) {
  return (
    <>
      <UnreadDot unread={props.unread} />
      <NotificationIcon
        notification={props.notification}
        class="size-3.5 shrink-0 text-ink-muted/60"
      />
      <NotificationSenderIcon notification={props.notification} size="sm" />
      <span
        class={cn(
          'ph-no-capture truncate min-w-0 text-xs text-ink',
          props.unread && 'font-medium'
        )}
      >
        <NotificationDescription notification={props.notification} />
      </span>
    </>
  );
}

function HeaderTrailing(props: {
  notification: UnifiedNotification;
  canMarkDone: boolean;
  onMarkAsDone: () => void;
}) {
  return (
    // h-5 locks this slot to the mark-done button's height so swapping
    // between the timestamp and the button on hover does not change the row
    // height. justify-end keeps the timestamp right-aligned within the slot.
    <div class="shrink-0 ml-auto h-5 flex items-center justify-end">
      <span
        class={cn('text-ink-extra-muted text-xs tabular-nums', {
          'group-hover/notif:hidden': props.canMarkDone,
        })}
      >
        <NotificationTimestamp notification={props.notification} />
      </span>
      <Show when={props.canMarkDone}>
        <Button
          onClick={(e) => {
            e.stopPropagation();
            props.onMarkAsDone();
          }}
          tooltip="Mark done"
          class="rounded text-ink-muted hover:text-accent hover:bg-accent/10 hidden group-hover/notif:grid p-0 place-items-center size-5"
        >
          <CheckIcon class="size-3" />
        </Button>
      </Show>
    </div>
  );
}

// Indent under the description: indicator(6) + gap(10) + icon(14) + gap(10) +
// sender-icon(16) + gap(10) = 66px ≈ pl-[3.625rem]. Keep in sync if the row
// gap or icon sizes change.
const CONTENT_INDENT = 'pl-[3.625rem]';

function CompactBody(props: BodyProps) {
  return (
    <Layout
      class={cn(
        'group/notif @container/notif-row flex items-center gap-2.5 px-3 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden cursor-pointer',
        props.class
      )}
    >
      <HeaderLeading notification={props.notification} unread={props.unread} />
      {/*
        The content slot truncates to one line. At narrow widths it collapses
        to "X...", which reads worse than just dropping it — the description
        ("Gabriel mentioned you") + timestamp already tell the story. Hide
        below the container's md breakpoint.
      */}
      <span class="hidden @md/notif-row:flex flex-1 min-w-0 ph-no-capture truncate text-xs text-ink-muted/60">
        {props.contentOverride ?? (
          <NotificationRowContent
            notification={props.notification}
            singleLine
          />
        )}
      </span>
      <HeaderTrailing
        notification={props.notification}
        canMarkDone={props.canMarkDone}
        onMarkAsDone={props.onMarkAsDone}
      />
    </Layout>
  );
}

function ExpandedBody(props: BodyProps) {
  return (
    <Layout
      class={cn(
        'group/notif flex flex-col px-4 py-3 hover:bg-ink-muted/6 min-w-0 overflow-hidden cursor-pointer',
        props.class
      )}
    >
      <div class="flex items-center gap-2.5 min-w-0">
        <HeaderLeading
          notification={props.notification}
          unread={props.unread}
        />
        <span class="flex-1" />
        <HeaderTrailing
          notification={props.notification}
          canMarkDone={props.canMarkDone}
          onMarkAsDone={props.onMarkAsDone}
        />
      </div>
      <div
        class={cn(
          'ph-no-capture min-w-0 text-xs text-ink-muted/80 pt-2 wrap-break-words',
          CONTENT_INDENT
        )}
      >
        {props.contentOverride ?? (
          <NotificationRowContent notification={props.notification} />
        )}
      </div>
    </Layout>
  );
}

/**
 * A single, unstacked notification row.
 *
 * Comes in two variants:
 * - `compact` (default): one-line row used in dense lists (right-panel
 *   notifications card). Mirrors `NotificationStackRow` layout.
 * - `full`: header + body + multi-line content used when each notification gets
 *   its own card (bell popover, inbox detail). Replaces the old
 *   `NotificationRenderer mode="full"` rendering.
 *
 * Both variants share click handling, the context menu, and the mark-done
 * affordance — opt out with `showMarkDone={false}`.
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

  const handleClick = async (e: PointerEvent | MouseEvent | KeyboardEvent) => {
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

  const handleMarkAsDone = () => {
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

  const bodyProps = (): BodyProps => ({
    notification: props.notification,
    unread: unread(),
    canMarkDone: canMarkDone(),
    onMarkAsDone: handleMarkAsDone,
    contentOverride: props.content,
    class: props.class,
  });

  return (
    <ContextMenu>
      <ContextMenu.Trigger class="size-full">
        <div
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
          <Switch fallback={<CompactBody {...bodyProps()} />}>
            <Match when={props.variant === 'expanded'}>
              <ExpandedBody {...bodyProps()} />
            </Match>
          </Switch>
        </div>
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
