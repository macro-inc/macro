import { Show, createEffect } from 'solid-js';
import { reconcile, createStore } from 'solid-js/store';
import {
  stackNotifications,
  type NotificationStack,
  getMostRecentNotification,
  openNotification,
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
import { useNotificationStackActions } from './notification-actions';
import { Button } from '@ui/components/Button';
import CheckIcon from '@icon/regular/check.svg';

const DEFAULT_VISIBLE_COUNT = 3;

interface NotificationStacksProps {
  entity: WithNotification<EntityData>;
  onClick?: (e: PointerEvent | MouseEvent) => void;
  visibleCount?: number;
}

function NotificationStackRow(props: {
  stack: NotificationStack;
  onClick?: (e: PointerEvent | MouseEvent) => void;
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
          <div class="flex-shrink-0">
            <NotificationSenderIcon stack={props.stack} size="xs" />
          </div>
          <span class="ph-no-capture truncate min-w-0">
            <NotificationDescription stack={props.stack} />
          </span>
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
        <div class="ph-no-capture mt-1 truncate min-w-0 overflow-hidden">
          <NotificationContent stack={props.stack} />
        </div>
      </div>
    </div>
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
      <CollapsibleList
        items={stacks}
        visibleCount={props.visibleCount ?? DEFAULT_VISIBLE_COUNT}
        togglePosition="bottom"
      >
        {(stack) => (
          <NotificationStackRow stack={stack} onClick={props.onClick} />
        )}
      </CollapsibleList>
    </Show>
  );
}
