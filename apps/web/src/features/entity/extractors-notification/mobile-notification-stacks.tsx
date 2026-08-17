import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  SwipableRow,
  SwipableRowContext,
} from '@components/app/mobile/SwipableRow';
import {
  getMostRecentNotification,
  type NotificationStack,
  openNotification,
} from '@notifications';
import { cn } from '@ui';
import { createEffect, type JSX, Show, useContext } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { CollapsibleList } from '../components/CollapsibleList';
import { UnreadIndicator } from '../components/UnreadIndicator';
import { InboxDivider } from '../composed/list-entity/shared';
import { Entity } from '../entity';
import { type EntityData, isChannelEntity } from '../types/entity';
import type { WithNotification } from '../types/notification';
import { isNotificationUnread } from '../utils/notification';
import { useNotificationStackActions } from './notification-actions';
import { NotificationContent } from './notification-content';
import { NotificationDescription } from './notification-description';
import { NotificationIcon } from './notification-icon';
import { NotificationSenderIcon } from './notification-sender-icon';
import { NotificationTimestamp } from './notification-timestamp';

export type EntityRowConfig = {
  swipeLeftColor?: string;
  swipeLeftRevealedComponent?: JSX.Element;
  swipeRightColor?: string;
  swipeRightRevealedComponent?: JSX.Element;
};

/**
 * One notification stack in the NarrowInboxLayout visual language: unread dot
 * + entity avatar, entity title + stack timestamp, and a two-line body — the
 * stack's description ("Peter: 3 replies") over its latest content preview.
 */
function MobileStackRowLayout(props: {
  stack: NotificationStack;
  entity: WithNotification<EntityData>;
  unread: boolean;
  onClick?: (e: MouseEvent) => void;
}) {
  const isDirectMessage = () =>
    isChannelEntity(props.entity) &&
    props.entity.channelType === 'direct_message';

  return (
    <Entity.Layout
      class="w-full text-sm grid"
      onClick={props.onClick}
      style={{
        'grid-template-columns': 'auto 1fr 8ch',
        'grid-template-rows': 'auto auto auto',
        'grid-template-areas':
          '"icon title timestamp" "icon body body" "icon body body"',
      }}
    >
      <Entity.Slot
        placement="icon"
        class="flex items-center self-center pr-(--soup-inbox-icon-padding-r)"
      >
        <UnreadIndicator
          class="mx-(--soup-inbox-unread-indicator-padding-x) size-(--soup-inbox-unread-indicator-diameter)"
          active={props.unread}
        />
        <Show
          when={isDirectMessage()}
          fallback={
            <div class="size-(--soup-inbox-icon-diameter) shrink-0 bg-edge-muted rounded-full flex items-center justify-center">
              <div class="size-[calc(var(--soup-inbox-icon-diameter)*var(--soup-inbox-icon-factor))]">
                <Entity.Icon entity={props.entity} />
              </div>
            </div>
          }
        >
          <div class="size-11 shrink-0">
            <Entity.Icon entity={props.entity} class="bg-edge-muted text-ink" />
          </div>
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class="ph-no-capture flex items-center gap-2 truncate font-semibold pt-3"
      >
        <Entity.Title entity={props.entity} />
      </Entity.Slot>

      <Entity.Slot
        placement="timestamp"
        class="text-xs text-right text-ink-extra-muted font-light pt-3 pr-4 tabular-nums"
      >
        <NotificationTimestamp stack={props.stack} />
      </Entity.Slot>

      <Entity.Slot
        placement="body"
        class="flex flex-col gap-0.5 pb-2 min-h-[2lh] pr-4 min-w-0"
      >
        <span class="flex items-center gap-1.5 min-w-0">
          <NotificationIcon
            stack={props.stack}
            class="size-3 shrink-0 text-ink-muted/60"
          />
          <NotificationSenderIcon stack={props.stack} size="sm" />
          <span class="ph-no-capture truncate min-w-0 font-medium text-ink-muted">
            <NotificationDescription stack={props.stack} />
          </span>
        </span>
        <span
          class={cn('ph-no-capture text-ink-extra-muted', {
            truncate: props.stack.type !== 'document_mention',
          })}
        >
          <NotificationContent stack={props.stack} />
        </span>
      </Entity.Slot>
      <InboxDivider />
    </Entity.Layout>
  );
}

function MobileStackRow(props: {
  stack: NotificationStack;
  entity: WithNotification<EntityData>;
  entityRowConfig?: EntityRowConfig;
}) {
  const ctx = useContext(SwipableRowContext);
  const notificationSource = useGlobalNotificationSource();
  const { markStackAsDone } = useNotificationStackActions({
    stack: props.stack,
    entityId: props.entity.id,
  });
  const stackEntityId = () => getMostRecentNotification(props.stack).id;
  const unread = () => isNotificationUnread(props.stack);

  const handleSwipeLeft = async () => {
    await ctx?.collapseRow(stackEntityId());
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
    <SwipableRow
      id={stackEntityId()}
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
    </SwipableRow>
  );
}

// Wraps a NotificationStack with a stable id for reconcile, since
// NotificationStack itself has no id field.
type KeyedStack = NotificationStack & { id: string };

function keyStack(stack: NotificationStack): KeyedStack {
  return { ...stack, id: getMostRecentNotification(stack).id };
}

interface MobileNotificationStackRowsProps {
  stacks: NotificationStack[];
  entity: WithNotification<EntityData>;
  entityRowConfig?: EntityRowConfig;
  visibleCount?: number;
}

/**
 * The mobile inbox rendering of an entity's notifications: one
 * NarrowInboxLayout-styled row per stack, using the same per-thread splitting
 * as desktop (stackNotifications) — top-level channel sends share one row,
 * and each thread (replies + thread mentions of one parent message) gets its
 * own. Each row swipes and opens independently.
 */
export function MobileNotificationStackRows(
  props: MobileNotificationStackRowsProps
) {
  const [stacks, setStacks] = createStore<KeyedStack[]>([]);

  createEffect(() => {
    setStacks(
      reconcile(props.stacks.map(keyStack), { key: 'id', merge: false })
    );
  });

  return (
    <CollapsibleList
      items={stacks}
      visibleCount={props.visibleCount ?? 3}
      togglePosition="bottom"
      expandText={(count) => `Show ${count} more`}
      persistKey={`notif-stacks:${props.entity.id}`}
    >
      {(stack) => (
        <MobileStackRow
          stack={stack}
          entity={props.entity}
          entityRowConfig={props.entityRowConfig}
        />
      )}
    </CollapsibleList>
  );
}
