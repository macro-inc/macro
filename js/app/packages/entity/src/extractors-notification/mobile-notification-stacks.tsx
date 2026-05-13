import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { EntityRow, EntityRowContext } from '@app/component/mobile/EntityRow';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  getMostRecentNotification,
  type NotificationStack,
  openNotification,
} from '@notifications';
import { cn } from '@ui';
import { createEffect, type JSX, useContext } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { CollapsibleList } from '../components/CollapsibleList';
import { Entity } from '../entity';
import { type EntityData, isChannelEntity } from '../types/entity';
import type { WithNotification } from '../types/notification';
import { isNotificationUnread } from '../utils/notification';
import { useNotificationStackActions } from './notification-actions';
import { NotificationContent } from './notification-content';
import { NotificationSenderIcon } from './notification-sender-icon';
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
      class="w-full text-sm grid"
      onClick={props.onClick}
      style={{
        'grid-template-columns': 'auto 1fr auto',
        'grid-template-rows': 'auto auto',
        'grid-template-areas': '"icon title timestamp" "icon body body"',
      }}
    >
      <Entity.Slot
        placement="icon"
        class="flex flex-col items-center gap-1 pt-3.5 pl-3 pr-2"
      >
        <Entity.Notification.Icon
          stack={props.stack}
          class={cn('size-3.5 shrink-0', {
            'text-accent': props.unread,
            'text-ink-muted': !props.unread,
          })}
        />
        <span
          class={cn('size-1.5 rounded-full bg-accent shrink-0 opacity-0', {
            'opacity-100': props.unread,
          })}
        />
      </Entity.Slot>
      <Entity.Slot
        placement="title"
        class="flex items-center gap-2 overflow-hidden min-w-0 pt-3"
      >
        <NotificationSenderIcon stack={props.stack} size="sm" />
        <span class="truncate min-w-0 font-medium text-ink">
          <Entity.Notification.Description stack={props.stack} />
        </span>
      </Entity.Slot>
      <Entity.Slot
        placement="timestamp"
        class="text-xs text-right text-ink-extra-muted pt-3 pr-4 pl-2 tabular-nums"
      >
        <NotificationTimestamp stack={props.stack} />
      </Entity.Slot>
      <Entity.Slot
        placement="body"
        class={cn('text-ink-muted/80 pb-2.5 min-h-lh pr-4 text-xs', {
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
      <div class="rounded-lg border border-ink-muted/8 bg-ink-muted/[0.025] overflow-hidden divide-y divide-ink-muted/8">
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
