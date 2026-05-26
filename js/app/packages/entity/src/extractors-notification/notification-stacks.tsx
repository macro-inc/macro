import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import { buildSimpleEntityUrl } from '@core/util/url';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { UnifiedNotification } from '@notifications';
import {
  getChannelNotificationParams,
  getMostRecentNotification,
  type NotificationStack,
  openNotification,
  stackNotifications,
} from '@notifications';
import CheckIcon from '@phosphor/check.svg';
import { Button, cn } from '@ui';
import { createEffect, type JSX, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { CollapsibleList } from '../components/CollapsibleList';
import type { EntityData } from '../types/entity';
import type { WithNotification } from '../types/notification';
import {
  filterNotDoneNotifications,
  filterValidNotifications,
  isNotificationUnread,
} from '../utils/notification';
import { useNotificationStackActions } from './notification-actions';
import { NotificationContent } from './notification-content';
import { NotificationDescription } from './notification-description';
import { NotificationIcon } from './notification-icon';
import { NotificationSenderIcon } from './notification-sender-icon';
import { NotificationTimestamp } from './notification-timestamp';

const DEFAULT_VISIBLE_COUNT = 3;

function getNotificationUrl(notification: UnifiedNotification): string {
  const { params } = getChannelNotificationParams(notification);
  return buildSimpleEntityUrl(
    { type: notification.entity_type, id: notification.entity_id },
    params
  );
}

interface NotificationStacksProps {
  entity: WithNotification<EntityData>;
  onClick?: (e: PointerEvent | MouseEvent | KeyboardEvent) => void;
  visibleCount?: number;
}

export function NotificationStackRow(props: {
  stack: NotificationStack;
  entity: EntityData;
  onClick?: (e: PointerEvent | MouseEvent | KeyboardEvent) => void;
  content?: JSX.Element;
  showMarkDone?: boolean;
}) {
  const notificationSource = useGlobalNotificationSource();
  const unread = () => isNotificationUnread(props.stack);
  const canMarkDone = () =>
    props.showMarkDone !== false && props.stack.type !== 'call-started';

  const { markStackAsDone, markStackAsRead } = useNotificationStackActions({
    stack: props.stack,
    entityId: props.entity.id,
  });

  const handleClick = async (e: PointerEvent | MouseEvent | KeyboardEvent) => {
    const mostRecent = getMostRecentNotification(props.stack);
    const splitManager = globalSplitManager();
    if (!splitManager) return;

    e.stopPropagation();
    const entity = props.entity;
    const entityOverride = {
      fileType: 'fileType' in entity ? entity.fileType : undefined,
      subType: 'subType' in entity ? entity.subType : undefined,
    };
    await openNotification(
      mostRecent,
      splitManager,
      e.shiftKey,
      entityOverride
    );
    await notificationSource.markAsRead(mostRecent);
    props.onClick?.(e);
  };

  const handleMarkAsDone = (e?: PointerEvent | MouseEvent) => {
    e?.stopPropagation();
    markStackAsDone();
  };

  const handleMarkAsRead = async () => {
    await markStackAsRead();
  };

  const handleCopyLink = async () => {
    const mostRecent = getMostRecentNotification(props.stack);
    const url = getNotificationUrl(mostRecent);
    await navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  };

  return (
    <ContextMenu>
      <ContextMenu.Trigger class="size-full">
        <div
          class="group/notif flex items-center gap-2.5 px-3 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden cursor-pointer"
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
          <span
            class={cn('size-1.5 rounded-full shrink-0', {
              'bg-accent': unread(),
              'bg-transparent': !unread(),
            })}
          />
          <NotificationIcon
            stack={props.stack}
            class="size-3.5 shrink-0 text-ink-muted/60"
          />
          <div class="shrink-0">
            <NotificationSenderIcon stack={props.stack} size="sm" />
          </div>
          <span
            class={cn('ph-no-capture truncate min-w-0 text-xs text-ink', {
              'font-medium': unread(),
            })}
          >
            <NotificationDescription stack={props.stack} />
          </span>
          <span class="ph-no-capture truncate min-w-0 text-xs text-ink-muted/60 flex-1">
            {props.content ?? (
              <NotificationContent stack={props.stack} singleLine />
            )}
          </span>
          <div class="shrink-0 ml-auto">
            <span
              class={cn('text-ink-extra-muted text-xs tabular-nums', {
                'group-hover/notif:hidden': canMarkDone(),
              })}
            >
              <NotificationTimestamp stack={props.stack} />
            </span>
            <Show when={canMarkDone()}>
              <Button
                onClick={handleMarkAsDone}
                tooltip={'Mark done'}
                class="rounded text-ink-muted hover:text-accent hover:bg-accent/10 hidden group-hover/notif:grid p-0 place-items-center size-5"
              >
                <CheckIcon class="size-3" />
              </Button>
            </Show>
          </div>
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

export function NotificationStacks(props: NotificationStacksProps) {
  const notifications = () => props.entity.notifications?.() ?? [];
  const validNotifications = () =>
    filterNotDoneNotifications(filterValidNotifications(notifications()));
  const [stacks, setStacks] = createStore<NotificationStack[]>([]);

  createEffect(() => {
    const newStacks = stackNotifications(validNotifications());
    setStacks(reconcile(newStacks, { key: 'id', merge: false }));
  });

  return (
    <Show when={stacks.length > 0}>
      <div class="rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden">
        <div class="divide-y divide-ink-muted/8">
          <CollapsibleList
            items={stacks}
            visibleCount={props.visibleCount ?? DEFAULT_VISIBLE_COUNT}
            togglePosition="bottom"
          >
            {(stack) => (
              <NotificationStackRow
                stack={stack}
                entity={props.entity}
                onClick={props.onClick}
              />
            )}
          </CollapsibleList>
        </div>
      </div>
    </Show>
  );
}
