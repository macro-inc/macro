import { Show, createEffect, For, createSignal, type JSX } from 'solid-js';
import { reconcile, createStore } from 'solid-js/store';
import {
  stackNotifications,
  type NotificationStack,
  getMostRecentNotification,
  openNotification,
  type UnifiedNotification,
} from '@notifications';
import type { WithNotification } from '../types/notification';
import type { EntityData } from '../types/entity';
import { CollapsibleList } from '../components/CollapsibleList';
import {
  filterValidNotifications,
  filterNotDoneNotifications,
  isNotificationUnread,
} from '../utils/notification';
import { NotificationContent } from './notification-content';
import { NotificationIcon } from './notification-icon';
import { NotificationDescription } from './notification-description';
import { NotificationSenderIcon } from './notification-sender-icon';
import { NotificationTimestamp } from './notification-timestamp';
import { UnreadIndicator } from '../components/UnreadIndicator';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { cn } from '@ui/utils/classname';
import {
  useNotificationStackActions,
  useNotificationActions,
} from './notification-actions';
import { Button } from '@ui/components/Button';
import CheckIcon from '@icon/regular/check.svg';
import { EntityIcon } from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { ENABLE_DOCUMENT_MENTION_NOTIFICATIONS } from '@core/constant/featureFlags';

const DEFAULT_VISIBLE_COUNT = 3;

interface NotificationStacksProps {
  entity: WithNotification<EntityData>;
  onClick?: (e: PointerEvent | MouseEvent) => void;
  visibleCount?: number;
}

function NotificationStackRow(props: {
  stack: NotificationStack;
  onClick?: (e: PointerEvent | MouseEvent) => void;
  content?: JSX.Element;
  description?: JSX.Element;
}) {
  const notificationSource = useGlobalNotificationSource();
  const unread = () => isNotificationUnread(props.stack);

  const { markStackAsDone } = useNotificationStackActions({
    stack: props.stack,
  });

  const handleClick = async (e: PointerEvent | MouseEvent) => {
    const mostRecent = getMostRecentNotification(props.stack);
    const splitManager = globalSplitManager();
    if (!splitManager) return;

    e.stopPropagation();
    await openNotification(mostRecent, splitManager, e.shiftKey);
    await notificationSource.markAsRead(mostRecent);
    props.onClick?.(e);
  };

  const handleMarkAsDone = async (e: PointerEvent | MouseEvent) => {
    e.stopPropagation();
    await markStackAsDone();
  };

  return (
    <div
      class={cn(
        'flex p-2 pr-0 my-1 border-l-2 border-edge-muted bg-edge/10 gap-4 hover:bg-edge/20 min-w-0 overflow-hidden'
      )}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e as unknown as MouseEvent);
        }
      }}
    >
      <div class="pt-1 flex-shrink-0">
        <NotificationIcon stack={props.stack} class="size-4" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1 text-xs min-w-0 overflow-hidden">
          <span
            class={cn(
              'w-0 transition-[width] overflow-hidden duration-500 ease flex-shrink-0',
              {
                'w-4': unread(),
              }
            )}
          >
            <UnreadIndicator active />
          </span>
          <Show
            when={props.description}
            fallback={
              <>
                <div class="flex-shrink-0">
                  <NotificationSenderIcon stack={props.stack} size="xs" />
                </div>
                <span class="ph-no-capture truncate min-w-0">
                  <NotificationDescription stack={props.stack} />
                </span>
              </>
            }
          >
            {props.description}
          </Show>
          <span class="text-ink-extra-muted/50 flex-shrink-0">
            {' - '}
            <NotificationTimestamp stack={props.stack} />
          </span>
          <div class="ml-auto flex items-center gap-1 pr-2 flex-shrink-0">
            <Button
              onClick={handleMarkAsDone}
              tooltip={'Mark notification stack done'}
              class="border border-edge-muted text-xs text-ink-muted grid p-0 place-items-center size-6"
            >
              <CheckIcon class="size-3" />
            </Button>
          </div>
        </div>
        <div
          class={cn('ph-no-capture mt-1 min-w-0', {
            'truncate overflow-hidden': !props.content,
          })}
        >
          {props.content ?? <NotificationContent stack={props.stack} />}
        </div>
      </div>
    </div>
  );
}

function DocumentMentionPill(props: { notification: UnifiedNotification }) {
  const notificationSource = useGlobalNotificationSource();
  const { markAsDone } = useNotificationActions({
    notification: props.notification,
  });

  const documentMeta = () => {
    const m = props.notification.notification_metadata;
    return m.tag === 'document_mention' ? m.content : undefined;
  };
  const documentName = () => documentMeta()?.documentName ?? 'Untitled';
  const targetType = () => {
    const meta = documentMeta();
    // subType will be typed once orval regenerates the notification schemas
    const subTypeStr = (
      meta as { subType?: { type: string } | null } | undefined
    )?.subType?.type;
    return fileTypeToBlockName(subTypeStr ?? meta?.fileType) ?? 'default';
  };

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    const splitManager = globalSplitManager();
    if (!splitManager) return;
    await openNotification(props.notification, splitManager, e.shiftKey);
    await notificationSource.markAsRead(props.notification);
  };

  return (
    <div
      class="group relative flex items-center gap-1.5 px-2 py-1 rounded border border-edge-muted bg-panel hover:bg-hover cursor-pointer text-xs min-w-0 max-w-48 flex-shrink-0"
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      <EntityIcon targetType={targetType()} size="xs" />
      <span class="truncate min-w-0">{documentName()}</span>
      <Button
        class="absolute -top-2 -right-2 size-6 rounded-full bg-panel border border-edge-muted p-0 place-items-center hidden group-hover:grid hover:bg-accent! hover:text-panel!"
        tooltip="Mark as done"
        onClick={(e) => {
          e.stopPropagation();
          markAsDone();
        }}
      >
        <CheckIcon class="size-2.5" />
      </Button>
    </div>
  );
}

const MAX_VISIBLE_PILLS = 4;

function DocumentMentionPills(props: { stack: NotificationStack }) {
  const [expanded, setExpanded] = createSignal(false);
  const notifications = () => props.stack.notifications;
  const visible = () =>
    expanded() ? notifications() : notifications().slice(0, MAX_VISIBLE_PILLS);
  const overflow = () =>
    Math.max(0, notifications().length - MAX_VISIBLE_PILLS);

  return (
    <div class="flex flex-wrap items-center gap-1.5 pt-1">
      <For each={visible()}>
        {(n) => <DocumentMentionPill notification={n} />}
      </For>
      <Show when={!expanded() && overflow() > 0}>
        <button
          class="text-xs text-ink-muted border border-edge-muted rounded px-2 py-1 bg-panel hover:bg-edge/10 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          + {overflow()} more files
        </button>
      </Show>
    </div>
  );
}

function DocumentMentionStackRow(props: {
  stack: NotificationStack;
  onClick?: (e: PointerEvent | MouseEvent) => void;
}) {
  return (
    <NotificationStackRow
      stack={props.stack}
      onClick={props.onClick}
      description={
        <span class="text-ink-muted">
          {props.stack.notifications.length} files shared
        </span>
      }
      content={<DocumentMentionPills stack={props.stack} />}
    />
  );
}

export function NotificationStacks(props: NotificationStacksProps) {
  const notificationSource = useGlobalNotificationSource();
  const notifications = () => props.entity.notifications?.() ?? [];
  const validNotifications = () =>
    filterNotDoneNotifications(filterValidNotifications(notifications()));

  const [stacks, setStacks] = createStore<NotificationStack[]>([]);

  createEffect(() => {
    const newStacks = stackNotifications(validNotifications());
    setStacks(reconcile(newStacks, { key: 'id', merge: false }));
  });

  // When the feature flag is off, auto-mark all document_mention notifications
  // as done so they are dismissed and never shown.
  createEffect(() => {
    if (ENABLE_DOCUMENT_MENTION_NOTIFICATIONS) return;
    const docMentions = validNotifications().filter(
      (n) => n.notification_metadata.tag === 'document_mention'
    );
    if (docMentions.length > 0) {
      void notificationSource.bulkMarkAsDone(docMentions);
    }
  });

  const displayedStacks = () =>
    ENABLE_DOCUMENT_MENTION_NOTIFICATIONS
      ? stacks
      : stacks.filter((s) => s.type !== 'document_mention');

  return (
    <Show when={displayedStacks().length > 0}>
      <CollapsibleList
        items={displayedStacks()}
        visibleCount={props.visibleCount ?? DEFAULT_VISIBLE_COUNT}
        togglePosition="bottom"
      >
        {(stack) => (
          <Show
            when={stack.type === 'document_mention'}
            fallback={
              <NotificationStackRow stack={stack} onClick={props.onClick} />
            }
          >
            <DocumentMentionStackRow stack={stack} onClick={props.onClick} />
          </Show>
        )}
      </CollapsibleList>
    </Show>
  );
}
