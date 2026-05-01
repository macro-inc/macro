import { useContext, createEffect, type JSX } from 'solid-js';
import { reconcile, createStore } from 'solid-js/store';
import {
  type NotificationStack,
  getMostRecentNotification,
  openNotification,
} from '@notifications';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { WithNotification } from '../types/notification';
import { isChannelEntity, type EntityData } from '../types/entity';
import { CollapsibleList } from '../components/CollapsibleList';
import { isNotificationUnread } from '../utils/notification';
import { Entity } from '../entity';
import { UnreadIndicator } from '../components/UnreadIndicator';
import { EntityRow, EntityRowContext } from '@app/component/mobile/EntityRow';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { cn } from '@ui/utils/classname';
import { useNotificationStackActions } from './notification-actions';
import { NotificationContent } from './notification-content';
import { NotificationTimestamp } from './notification-timestamp';

export type EntityRowConfig = {
  swipeLeftColor?: string;
  swipeLeftRevealedComponent?: JSX.Element;
  swipeRightColor?: string;
  swipeRightRevealedComponent?: JSX.Element;
};

function MobileStackRowLayout(props: {
  stack: NotificationStack;
  entity: WithNotification<EntityData>;
  unread: boolean;
  onClick?: (e: MouseEvent) => void;
}) {
  return (
    <Entity.Layout
      class="w-full text-sm grid bg-message border-edge"
      onClick={props.onClick}
      style={{
        'grid-template-columns':
          'var(--soup-stack-row-unread-column-width) 1fr auto',
        'grid-template-rows': 'auto auto',
        'grid-template-areas': '"unread title timestamp" "unread body body"',
        'border-left-width': 'var(--soup-stack-row-border-l)',
      }}
    >
      <Entity.Slot placement="unread" class="flex items-center justify-center">
        <UnreadIndicator
          class="mx-(--soup-inbox-unread-indicator-padding-x) size-(--soup-inbox-unread-indicator-diameter)"
          active={props.unread}
        />
      </Entity.Slot>
      <Entity.Slot
        placement="title"
        class="flex items-center gap-2 overflow-hidden min-w-0 font-semibold pt-3"
      >
        <Entity.Notification.Icon
          stack={props.stack}
          class="size-3.5 shrink-0"
        />
        <span class="truncate min-w-0">
          <Entity.Notification.Description stack={props.stack} />
        </span>
      </Entity.Slot>
      <Entity.Slot
        placement="timestamp"
        class="text-xs text-right text-ink-extra-muted font-light pt-3 pr-4 pl-2"
      >
        <NotificationTimestamp stack={props.stack} />
      </Entity.Slot>
      <Entity.Slot
        placement="body"
        class={cn('text-ink-extra-muted pb-2 min-h-lh pr-4', {
          truncate: props.stack.type !== 'document_mention',
        })}
      >
        <NotificationContent stack={props.stack} />
      </Entity.Slot>
    </Entity.Layout>
  );
}

function MobileStackRow(props: {
  stack: NotificationStack;
  entity: WithNotification<EntityData>;
  entityRowConfig?: EntityRowConfig;
}) {
  const ctx = useContext(EntityRowContext);
  const notificationSource = useGlobalNotificationSource();
  const { markStackAsDone } = useNotificationStackActions({
    stack: props.stack,
    entityId: props.entity.id,
  });
  const stackEntityId = () => getMostRecentNotification(props.stack).id;
  const unread = () => isNotificationUnread(props.stack);

  const handleSwipeLeft = async () => {
    await ctx?.collapseEntity(stackEntityId());
    markStackAsDone();
  };

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    const mostRecent = getMostRecentNotification(props.stack);
    const splitManager = globalSplitManager();
    if (!splitManager) return;
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
  };

  if (!ctx) {
    return (
      <MobileStackRowLayout
        stack={props.stack}
        entity={props.entity}
        unread={unread()}
        onClick={handleClick}
      />
    );
  }

  return (
    <EntityRow
      entityId={stackEntityId()}
      onSwipeLeft={handleSwipeLeft}
      swipeLeftColor={props.entityRowConfig?.swipeLeftColor}
      swipeLeftRevealedComponent={
        props.entityRowConfig?.swipeLeftRevealedComponent
      }
      swipeRightColor={props.entityRowConfig?.swipeRightColor}
      swipeRightRevealedComponent={
        props.entityRowConfig?.swipeRightRevealedComponent
      }
    >
      <MobileStackRowLayout
        stack={props.stack}
        entity={props.entity}
        unread={unread()}
        onClick={handleClick}
      />
    </EntityRow>
  );
}

// Wraps a NotificationStack with a stable id for reconcile, since
// NotificationStack itself has no id field.
type KeyedStack = NotificationStack & { id: string };

function keyStack(stack: NotificationStack): KeyedStack {
  return { ...stack, id: getMostRecentNotification(stack).id };
}

interface MobileNotificationStacksProps {
  stacks: NotificationStack[];
  entity: WithNotification<EntityData>;
  entityRowConfig?: EntityRowConfig;
  visibleCount?: number;
}

export function MobileNotificationStacks(props: MobileNotificationStacksProps) {
  const [stacks, setStacks] = createStore<KeyedStack[]>([]);

  createEffect(() => {
    setStacks(
      reconcile(props.stacks.map(keyStack), { key: 'id', merge: false })
    );
  });

  const isDirectMessage = () =>
    isChannelEntity(props.entity) &&
    props.entity.channelType === 'direct_message';

  return (
    <div class="pl-(--soup-stack-row-padding-l) pb-3 relative">
      {/* Non-swipeable header */}
      <div class="grid grid-cols-[calc(var(--soup-inbox-left-of-content)-var(--soup-stack-row-padding-l))_auto] w-full text-sm items-center pr-4 py-3">
        <div class="ml-(--soup-stack-header-icon-padding-l) mr-(--soup-inbox-icon-padding-r) shrink-0 size-(--soup-stack-icon-diameter) bg-edge-muted rounded-full flex items-center justify-center">
          <Entity.Icon
            entity={props.entity}
            class={cn(
              !isDirectMessage() &&
                'size-[calc(var(--soup-stack-icon-diameter)*var(--soup-inbox-icon-factor))]'
            )}
          />
        </div>
        <span class="flex-1 truncate font-semibold text-sm">
          <Entity.Title entity={props.entity} />
        </span>
      </div>
      {/* Stack rows */}
      <div class="flex flex-col gap-3">
        <CollapsibleList
          items={stacks}
          visibleCount={props.visibleCount ?? 3}
          togglePosition="bottom"
          expandText={(count) => `Show ${count} more`}
        >
          {(stack) => (
            <MobileStackRow
              stack={stack}
              entity={props.entity}
              entityRowConfig={props.entityRowConfig}
            />
          )}
        </CollapsibleList>
      </div>
    </div>
  );
}
