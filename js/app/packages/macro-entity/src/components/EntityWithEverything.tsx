import { EntityIcon } from '@core/component/EntityIcon';
import type { Property } from '@core/component/Properties/types';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import '@core/directive/dnd';
import { useDragOperation } from '@app/component/ItemDragAndDrop';
import { useEmail, useUserId } from '@core/context/user';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { matches } from '@core/util/match';
import ArrowBendUpLeftIcon from '@icon/regular/arrow-bend-up-left.svg';
import AtIcon from '@icon/regular/at.svg';
import ChatIcon from '@icon/regular/chat.svg';
import CheckIcon from '@icon/regular/check.svg';
import {
  getAllNotificationsFromGroup,
  getMetadata,
  getMostRecentNotification,
  isChannelMessageReply,
  type NotificationStack,
  stackNotifications,
  type TypedNotification,
  tryToTypedNotification,
} from '@notifications';
import { formatDocumentName } from '@service-storage/util/filename';
import { syncServiceClient } from '@service-sync/client';
import { ChannelTypeEnum } from '@service-comms/client';
import { mergeRefs } from '@solid-primitives/refs';
import { createDraggable } from '@thisbeyond/solid-dnd';
import { getEntityIconConfig } from 'core/component/EntityIcon';
import { StaticMarkdown } from 'core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from 'core/component/LexicalMarkdown/theme';
import { UserIcon } from 'core/component/UserIcon';
import {
  emailToMacroId,
  tryMacroId,
  useDisplayName,
  useDisplayNameParts,
} from 'core/user';
import type { JSX, ParentProps, Ref } from 'solid-js';
import {
  createDeferred,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  createProjectQuery,
  isProjectContainedEntity,
  type ProjectContainedEntity,
} from '../queries/project';
import { isSearchEntity } from '../queries/search';
import type { EntityDragData } from '../types/drag';
import {
  type EntityData,
  isTaskEntity,
  type ProjectEntity,
} from '../types/entity';
import type {
  Notification,
  WithNotification,
  WithStackedNotifications,
} from '../types/notification';
import type {
  ChannelContentHitData,
  ContentHitData,
  EmailContentHitData,
  SearchLocation,
  WithSearch,
} from '../types/search';
import { KeyPropertiesGrid } from './EntityPropertyValues';

export type EntityClickEvent = Parameters<
  JSX.EventHandler<HTMLDivElement, MouseEvent>
>[0];
type EntityPointerDownEvent = Parameters<
  JSX.EventHandler<HTMLDivElement, PointerEvent>
>[0];
type EntityClickProps<T extends EntityData, E> = {
  type: 'entity' | 'entity-project-path';
  entity: T;
  projectEntity?: T;
  event: E;
  location?: SearchLocation;
};
export type EntityClickHandler<T extends EntityData> = (
  args: EntityClickProps<T, EntityClickEvent>
) => void;
export type EntityPointerDownHandler<T extends EntityData> = (
  args: EntityClickProps<T, EntityPointerDownEvent>
) => void;

export const ENTITY_HEIGHT = 40;

function UnreadIndicator(props: { active?: boolean }) {
  return (
    <div class="flex size-4 items-center justify-center">
      <div
        classList={{
          'bg-accent rounded-full size-2': true,
          'opacity-0': !props.active,
        }}
      />
    </div>
  );
}

function SharedBadge(props: { ownerId: string }) {
  return (
    <div class="font-mono font-medium user-select-none uppercase flex items-center text-ink-extra-muted p-0.5 gap-1 text-[0.625rem] rounded-full border border-edge-muted pr-2">
      <UserIcon id={props.ownerId} size="xs" />
      shared
    </div>
  );
}

function GenericContentHit(props: { data: ContentHitData }) {
  return (
    <div class="text-ink-muted truncate flex items-center">
      <StaticMarkdown
        markdown={props.data.content}
        theme={unifiedListMarkdownTheme}
        singleLine={true}
      />
    </div>
  );
}

function ChannelMessageContentHit(props: { data: ChannelContentHitData }) {
  const [userName] = useDisplayName(tryMacroId(props.data.senderId));

  return (
    <div class="flex gap-2 items-center min-w-0">
      <div class="flex size-5 shrink-0 items-center justify-center">
        <UserIcon id={props.data.senderId} size="xs" />
      </div>
      <div class="flex gap-2 w-full min-w-0 overflow-hidden items-baseline">
        <div class="shrink-0 truncate min-w-0 font-medium">{userName()}</div>
        <div class="shrink-0 font-mono text-xs touch:mobile-width:text-sm uppercase text-ink-extra-muted">
          {createFormattedDate(props.data.sentAt)}
        </div>
        <div class="text-ink-muted truncate flex items-center flex-1 min-w-0">
          <StaticMarkdown
            markdown={props.data.content}
            theme={unifiedListMarkdownTheme}
            singleLine={true}
          />
        </div>
      </div>
    </div>
  );
}

function EmailMessageContentHit(props: {
  allData: EmailContentHitData[];
  data: EmailContentHitData;
}) {
  const isSingleMatch = createMemo(() => {
    return props.allData.length === 1;
  });
  const isSingleSender = createMemo(() => {
    const senders = props.allData.map((d) => d.sender);
    if (senders.length === 1) return true;
    if (new Set(senders).size === 1) return true;
    return false;
  });
  const isSingleSentAt = createMemo(() => {
    const sentAts = props.allData.map((d) => d.sentAt);
    if (sentAts.length === 1) return true;
    if (new Set(sentAts).size === 1) return true;
    const formattedDates = sentAts.map(createFormattedDate);
    if (new Set(formattedDates).size === 1) return true;
    return false;
  });

  return (
    <div class="flex gap-2 items-center min-w-0">
      <div class="flex size-5 shrink-0 items-center justify-center">
        <UserIcon id={props.data.senderId} size="xs" />
      </div>
      <div class="flex gap-2 w-full min-w-0 overflow-hidden items-baseline">
        <Show when={!isSingleMatch() && !isSingleSender()}>
          <div class="shrink-0 truncate min-w-0 font-medium">
            {props.data.sender}
          </div>
        </Show>
        <Show when={!isSingleMatch() && !isSingleSentAt()}>
          <div class="shrink-0 font-mono text-xs touch:mobile-width:text-sm uppercase text-ink-extra-muted">
            {createFormattedDate(props.data.sentAt)}
          </div>
        </Show>
        <div class="text-ink-muted truncate flex items-center flex-1 min-w-0">
          <StaticMarkdown
            markdown={props.data.content}
            theme={unifiedListMarkdownTheme}
            singleLine={true}
          />
        </div>
      </div>
    </div>
  );
}

function ThreadBorder() {
  return (
    <div
      class="absolute left-[calc(0.5rem+1px)] w-[1px] border-l border-edge-muted -top-0.75"
      style={{ height: '6px' }}
    />
  );
}

function CollapsibleListRow(
  props: ParentProps<{
    onClick?: (e: EntityClickEvent) => void;
    classList?: Record<string, boolean>;
    enableHover?: boolean;
    showThreadBorder?: boolean;
    blockNavigation?: boolean;
  }>
) {
  return (
    <div
      class="relative flex gap-1 items-center min-w-0 h-8 transition-all"
      classList={{
        'hover:bg-hover/50 hover:opacity-85':
          props.enableHover ?? !!props.onClick,
        ...props.classList,
      }}
      onClick={(e) => {
        if (props.onClick) {
          if (props.blockNavigation) {
            e.stopPropagation();
          }
          props.onClick(e);
        }
      }}
      data-blocks-navigation={props.blockNavigation}
    >
      <Show when={props.showThreadBorder}>
        <ThreadBorder />
      </Show>
      {props.children}
    </div>
  );
}

function CollapsibleList<T>(props: {
  items: T[];
  visibleCount?: number;
  children: (item: T, index?: number, count?: number) => any;
  threadBorder?: boolean;
}) {
  const [showAll, setShowAll] = createSignal(false);
  const visibleCount = () => props.visibleCount ?? 3;

  const visibleItems = () => {
    if (props.items.length <= visibleCount() || showAll()) {
      return props.items;
    }
    return props.items.slice(0, visibleCount());
  };

  const count = () => props.items.length;
  const hasMore = () => props.items.length > visibleCount();

  return (
    <>
      <For each={visibleItems()}>
        {(child, index) => props.children(child, index(), count())}
      </For>
      <Show when={hasMore()}>
        <div class="h-5">
          <Show when={props.threadBorder}>
            <ThreadBorder />
          </Show>
          <button
            class="block w-fit px-2 py-0.5 text-xxs border border-edge uppercase font-mono hover:font-medium"
            onClick={(e) => {
              e.stopPropagation();
              setShowAll((prev) => !prev);
            }}
            data-blocks-navigation
          >
            <Show when={!showAll()} fallback={<>Collapse</>}>
              + {props.items.length - visibleCount()} More
            </Show>
          </button>
        </div>
      </Show>
    </>
  );
}

function NotificationRow(props: {
  notification: Notification;
  onClick?: NotificationClickHandler;
  entity: EntityData;
  icon?: (props: { class?: string }) => JSX.Element;
}) {
  const [userName] = useDisplayName(
    tryMacroId(props.notification.senderId ?? '')
  );

  const ActionContent = () => {
    if (
      props.notification.notificationEventType === 'document_mention' ||
      props.notification.notificationEventType === 'channel_message_document'
    ) {
      return 'shared';
    }
    if (props.notification.notificationEventType === 'task_assigned') {
      return 'assigned to you';
    }
    if (props.notification.notificationEventType === 'channel_mention') {
      return 'mentioned you';
    }

    const metadata = tryToTypedNotification(
      props.notification
    )?.notificationMetadata;
    if (!metadata || !('messageContent' in metadata)) return '';

    return 'message';
  };

  const MessageContent = () => {
    if (
      props.notification.notificationEventType === 'document_mention' ||
      props.notification.notificationEventType === 'channel_message_document'
    ) {
      return '';
    }

    const typed = tryToTypedNotification(props.notification);
    if (!typed) return '';
    const metadata = getMetadata(typed);
    if (
      !metadata ||
      !('messageContent' in metadata) ||
      metadata.messageContent === undefined
    )
      return '';

    const content = metadata.messageContent;
    return (
      <Show
        when={content?.trim()}
        fallback={<span class="italic text-ink-disabled">Attached items</span>}
      >
        {(content) => (
          <StaticMarkdown
            markdown={content()}
            theme={unifiedListMarkdownTheme}
            singleLine={true}
          />
        )}
      </Show>
    );
  };

  return (
    <CollapsibleListRow
      showThreadBorder
      onClick={
        props.onClick
          ? (e) => {
              props.onClick?.({
                type: 'entity',
                entity: {
                  ...props.entity,
                  notification: props.notification,
                },
                event: e,
              });
            }
          : undefined
      }
    >
      <div class="flex size-5 shrink-0 items-center justify-center mr-1">
        <Show
          when={props.icon}
          fallback={<UserIcon id={props.notification.senderId!} size="xs" />}
        >
          <Dynamic component={props.icon} class="size-4 text-ink-muted" />
        </Show>
      </div>
      <div class="flex gap-1 w-full min-w-0 overflow-hidden items-baseline">
        <div class="w-[20cqw] shrink-0 truncate min-w-0">
          {userName()}{' '}
          <span class="opacity-70 uppercase font-mono text-[0.625rem] ml-2">
            {ActionContent()}
          </span>
        </div>
        <MessageContent />
      </div>
      <div class="shrink-0 font-mono text-xs touch:mobile-width:text-sm uppercase text-ink-extra-muted ml-2">
        {createFormattedDate(props.notification.createdAt)}
      </div>
    </CollapsibleListRow>
  );
}

/**
 * Shared row component for stacked notifications (new messages and replies)
 */
function StackedNotificationRow(props: {
  notifications: TypedNotification[];
  title: JSX.Element;
  icon: (props: { class?: string }) => JSX.Element;
  onClick?: (e: EntityClickEvent) => void;
}) {
  const mostRecent = () => props.notifications[0];

  // Get up to 3 unique sender IDs for avatar display
  const senderIds = createMemo(() => {
    const ids = new Set<string>();
    for (const n of props.notifications) {
      if (n.senderId) {
        ids.add(n.senderId);
        if (ids.size >= 3) break;
      }
    }
    return Array.from(ids);
  });

  // Get the sender of the most recent message
  const mostRecentSenderId = () => mostRecent()?.senderId ?? '';
  const [mostRecentSenderName] = useDisplayName(
    tryMacroId(mostRecentSenderId())
  );

  const messageContent = createMemo(() => {
    const notification = mostRecent();
    if (!notification) return '';
    const typed = tryToTypedNotification(notification);
    if (!typed) return '';
    const metadata = getMetadata(typed);
    if (metadata && 'messageContent' in metadata) {
      const content = metadata.messageContent as string | null | undefined;
      return content?.trim() ?? '';
    }
    return '';
  });

  return (
    <CollapsibleListRow showThreadBorder onClick={props.onClick}>
      <div class="flex size-5 shrink-0 items-center justify-center mr-1">
        <props.icon class="size-4 text-ink-muted" />
      </div>
      <div class="flex gap-1 w-full overflow-hidden items-baseline">
        {/* Count + Stacked avatars */}
        <div class="min-w-[20cqw] shrink-0 flex items-center gap-1">
          <span>{props.title}</span>
          <div class="flex shrink-0 items-center">
            <For each={senderIds()}>
              {(id, index) => (
                <div
                  class="flex size-5 items-center justify-center"
                  classList={{ '-ml-2': index() > 0 }}
                >
                  <UserIcon id={id} size="xs" />
                </div>
              )}
            </For>
          </div>
        </div>
        {/* Sender avatar + name + message content */}
        <Show when={mostRecentSenderId()}>
          <div class="flex items-center gap-1 flex-1 min-w-0">
            <span class="shrink-0 font-medium">{mostRecentSenderName()}</span>
            <Show when={messageContent()}>
              {(content) => (
                <div class="text-ink-muted truncate flex items-center flex-1 min-w-0">
                  <StaticMarkdown
                    markdown={content()}
                    theme={unifiedListMarkdownTheme}
                    singleLine={true}
                  />
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>
      <div class="shrink-0 font-mono text-xs touch:mobile-width:text-sm uppercase text-ink-extra-muted ml-2">
        {createFormattedDate(mostRecent().createdAt)}
      </div>
    </CollapsibleListRow>
  );
}

/**
 * Row component for stacked new messages
 */
function StackedNewMessagesRow(props: {
  group: NotificationStack & { type: 'channel_message_send' };
  onClick?: StackedNotificationClickHandler;
  entity: EntityData;
}) {
  const count = () => props.group.notifications.length;

  return (
    <StackedNotificationRow
      notifications={props.group.notifications}
      title={<>{count()} New Messages</>}
      icon={ChatIcon}
      onClick={
        props.onClick
          ? (e) =>
              props.onClick?.({
                group: props.group,
                entity: props.entity,
                event: e,
              })
          : undefined
      }
    />
  );
}

/**
 * Row component for stacked replies to a thread
 */
function StackedRepliesRow(props: {
  group: NotificationStack & { type: 'channel_message_reply' };
  onClick?: StackedNotificationClickHandler;
  entity: EntityData;
}) {
  const count = () => props.group.notifications.length;

  // Derive from notifications[0] (mostRecent)
  const threadParentSenderId = () => {
    const notification = props.group.notifications[0];
    if (!notification) return '';
    const typed = tryToTypedNotification(notification);
    if (!typed || !isChannelMessageReply(typed)) return '';
    const metadata = getMetadata(
      typed as TypedNotification<'channel_message_reply'>
    );
    return metadata?.threadParentSenderId ?? '';
  };

  const { firstName } = useDisplayNameParts(tryMacroId(threadParentSenderId()));

  const title = () => (
    <>
      {count()} {count() === 1 ? 'Reply' : 'Replies'}
      <Show when={firstName()}>{(name) => <> to {name}</>}</Show>
    </>
  );

  return (
    <StackedNotificationRow
      notifications={props.group.notifications}
      title={title()}
      icon={ArrowBendUpLeftIcon}
      onClick={
        props.onClick
          ? (e) =>
              props.onClick?.({
                group: props.group,
                entity: props.entity,
                event: e,
              })
          : undefined
      }
    />
  );
}

type StackedNotificationClickHandler<T extends EntityData = EntityData> =
  (args: {
    group: NotificationStack;
    entity: T;
    event: EntityClickEvent;
  }) => void;

/**
 * Renderer component that switches between different stacked notification types
 */
function StackedNotificationRenderer(props: {
  group: NotificationStack;
  onClick?: NotificationClickHandler;
  onClickStacked?: StackedNotificationClickHandler;
  entity: EntityData;
}) {
  return (
    <Switch>
      <Match when={props.group.type === 'channel_message_send' && props.group}>
        {(group) => (
          <StackedNewMessagesRow
            group={
              group() as NotificationStack & { type: 'channel_message_send' }
            }
            onClick={props.onClickStacked}
            entity={props.entity}
          />
        )}
      </Match>
      <Match when={props.group.type === 'channel_message_reply' && props.group}>
        {(group) => (
          <StackedRepliesRow
            group={
              group() as NotificationStack & { type: 'channel_message_reply' }
            }
            onClick={props.onClickStacked}
            entity={props.entity}
          />
        )}
      </Match>
      <Match when={props.group.type === 'channel_mention' && props.group}>
        {(group) => (
          <NotificationRow
            notification={group().notifications[0]}
            onClick={props.onClick}
            entity={props.entity}
            icon={AtIcon}
          />
        )}
      </Match>
      <Match
        when={
          props.group.type !== 'channel_message_send' &&
          props.group.type !== 'channel_message_reply' &&
          props.group.type !== 'channel_mention' &&
          props.group
        }
      >
        {(group) => (
          <NotificationRow
            notification={group().notifications[0]}
            onClick={props.onClick}
            entity={props.entity}
          />
        )}
      </Match>
    </Switch>
  );
}

function ContentHitRow(props: {
  allData: ContentHitData[];
  data: ContentHitData;
  onClick: (e: EntityClickEvent, location?: SearchLocation) => void;
  index?: number;
  count?: number;
}) {
  const match = (): [number, number] | undefined => {
    if (props.index !== undefined && props.count !== undefined)
      return [props.index, props.count];
  };

  return (
    <CollapsibleListRow
      blockNavigation
      onClick={(e) => props.onClick(e, props.data.location)}
      showThreadBorder={props.data.type === 'channel'}
    >
      <Switch>
        <Match when={props.data.type === 'channel' && props.data}>
          {(data) => <ChannelMessageContentHit data={data()} />}
        </Match>
        <Match when={props.data.type === 'email' && props.data}>
          {(data) => (
            <EmailMessageContentHit
              allData={props.allData as EmailContentHitData[]}
              data={data()}
            />
          )}
        </Match>
        <Match when={true}>
          <div class="flex gap-2 items-center min-w-0 w-full">
            <div class="flex size-5 shrink-0 items-center justify-center">
              <div class="h-4/5 border-l border-b w-2 border-edge-muted -translate-y-2 translate-x-[calc(0.25em-1px)]"></div>
            </div>
            <Show when={match()}>
              {(match) => {
                return (
                  <span class="font-mono text-xs touch:mobile-width:text-sm text-ink-disabled/50">
                    {match()[0] + 1}/{match()[1]}
                  </span>
                );
              }}
            </Show>
            <GenericContentHit data={props.data} />
          </div>
        </Match>
      </Switch>
    </CollapsibleListRow>
  );
}

// function ImportantBadge(props: { active?: boolean }) {
//   return (
//     <Show when={props.active}>
//       <div class="font-mono font-medium user-select-none uppercase flex items-center text-accent bg-accent/10 p-0.5 px-2 text-[0.625rem] rounded-full border border-accent/10">
//         <span class="@max-xl/split:hidden">Important</span>
//         <span class="hidden @max-xl/split:block font-bold">!</span>
//       </div>
//     </Show>
//   );
// }
//

type NotificationClickHandler<T extends EntityData = EntityData> =
  EntityClickHandler<
    WithStackedNotifications<T & { notification: Notification }>
  >;

interface EntityProps<T extends WithNotification<EntityData>>
  extends ParentProps {
  entity: T;
  focused?: boolean;
  timestamp?: number;
  onClick?: EntityClickHandler<T>;
  onDblClick?: EntityClickHandler<T>;
  onPointerDown?: EntityClickHandler<T>;
  onClickRowAction?: (entity: T, type: 'done') => void;
  onClickNotification?: NotificationClickHandler<T>;
  onMouseOver?: () => void;
  onMouseLeave?: () => void;
  onFocusIn?: () => void;
  onContextMenu?: () => void;
  properties?: Property[];
  contentPlacement?: 'middle' | 'bottom-row';
  unreadIndicatorActive?: boolean;
  fadeIfRead?: boolean;
  importantIndicatorActive?: boolean;
  showLeftColumnIndicator?: boolean;
  showUnrollNotifications?: boolean;
  showDoneButton?: boolean;
  highlighted?: boolean;
  selected: { active: boolean; muted?: boolean };
  ref?: Ref<HTMLDivElement>;
  onChecked?: (checked: boolean, shiftKey?: boolean) => void;
  checked?: boolean;
  searchActive?: boolean;
  splitId?: string;
}

const [hoveredComponentId, setHoveredComponentId] = createSignal<Symbol>(
  Symbol()
);

export function EntityWithEverything(
  props: EntityProps<WithNotification<EntityData | WithSearch<EntityData>>>
) {
  const id = Symbol();
  const [actionButtonRef, setActionButtonRef] =
    createSignal<HTMLButtonElement | null>(null);
  const [entityDivRef, setEntityDivRef] = createSignal<HTMLDivElement | null>(
    null
  );

  const { keydownDataDuringTask } = trackKeydownDuringTask();
  const userEmail = useEmail();

  const getIcon = createMemo(() => getEntityIconConfig(props.entity));

  /**
   * TODO (seamus + teo) : These notifications are being attached to the wrong
   *     entity - ie the channel and not the document being shared. this means
   *     we have notification rows that point to a channel but do not have a
   *     message_id to link to. These notifications result in 2 notifications
   *     on a channel when an item is shared. One for the message, and this
   *     weird busted one. Needs to be fixed in the service, then I will delete
   *     this logic.
   */
  const validNotifications = () => {
    return (
      props.entity.notifications?.().filter((notification) => {
        return (
          notification.notificationEventType !== 'channel_message_document'
        );
      }) ?? []
    );
  };

  const hasNotifications = () => validNotifications().length > 0;

  const notDoneNotifications = () => {
    return validNotifications().filter(({ done }) => !done);
  };

  const stackedNotificationsGroups = createMemo(() =>
    stackNotifications(notDoneNotifications())
  );

  const isSearch = createMemo(
    () => !!props.searchActive && isSearchEntity(props.entity)
  );

  const searchHighlightName = () =>
    isSearchEntity(props.entity) && props.entity.search.nameHighlight;

  const displayName = createMemo(() => {
    if (props.entity.type === 'document') {
      return formatDocumentName(props.entity.name, props.entity.fileType, {
        fullyQualifiedBlockName: true,
      });
    }
    return props.entity.name;
  });

  const contentHitData = () => {
    if (!isSearchEntity(props.entity)) return [];
    return props.entity.search.contentHitData ?? [];
  };

  onMount(() => {
    if (props.entity.type === 'document' && props.entity.fileType === 'md') {
      syncServiceClient.safeWakeup(props.entity.id);
      onCleanup(() => {
        syncServiceClient.cancelWakeup(props.entity.id);
      });
    }
  });

  const EntityTitle = createMemo(() => {
    if (props.entity.type === 'email') {
      const isLikelyEmail = (value?: string) =>
        typeof value === 'string' && value.includes('@');

      const combinedParticipantNames = createMemo(() => {
        if (props.entity.type !== 'email') return [];
        const me = userEmail();
        if (
          props.entity.participants?.length === 1 &&
          props.entity.participants?.[0].email === me
        ) {
          return ['me'];
        }
        const namesSet = new Set<string>();

        props.entity.participants?.forEach((participant) => {
          if (!participant.email) return;
          if (me && participant.email === me) return;
          const macroDisplayName = useDisplayName(
            emailToMacroId(participant.email)
          )[0]?.();
          const participantFullName = participant.name ?? '';
          if (macroDisplayName && !isLikelyEmail(macroDisplayName)) {
            namesSet.add(macroDisplayName);
          } else if (
            participantFullName &&
            !isLikelyEmail(participantFullName)
          ) {
            namesSet.add(participantFullName);
          } else {
            const emailName = participant.email.split('@')[0];
            namesSet.add(emailName);
          }
        });
        return Array.from(namesSet);
      });

      const displayedNames = () => {
        const names = combinedParticipantNames();
        if (!names || names.length === 0) return undefined;
        if (names.length === 1) return names[0];
        // For multiple participants, use first names only
        const firstNames = names.map((name) => name.split(' ')[0]);
        if (firstNames.length <= 3) return firstNames.join(', ');
        return `${firstNames[0]} .. ${firstNames[firstNames.length - 2]}, ${firstNames[firstNames.length - 1]}`;
      };

      return (
        <div class="flex gap-1 items-center min-w-0 w-full truncate overflow-hidden @max-md/uList:flex-col @max-md/uList:items-start @max-md/uList:gap-1 @max-md/uList:truncate-none">
          {/* sometimes senderName and senderEmail are the same */}
          <div
            class="flex gap-2 items-center font-semibold shrink-0 @max-md/uList:w-full @max-md/uList:truncate"
            classList={{
              'w-[20cqw]': !isSearch(),
            }}
          >
            {/* Icon inline with sender in narrow mode */}
            <div class="hidden @max-md/uList:flex size-[1em] shrink-0 items-center justify-center relative group/icon-checkbox">
              {/* Checkbox for narrow mode - shown on hover or when checked */}
              <button
                type="button"
                class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/icon-checkbox:opacity-100 transition-opacity"
                classList={{
                  'opacity-100': props.checked,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onChecked?.(!props.checked, e.shiftKey);
                }}
                data-blocks-navigation
              >
                <div
                  class="size-[0.875em] flex items-center justify-center rounded-xs border border-edge-muted pointer-events-none"
                  classList={{
                    'bg-accent border-accent': props.checked,
                  }}
                >
                  <Show when={props.checked}>
                    <CheckIcon class="w-full h-full text-panel" />
                  </Show>
                </div>
              </button>
              {/* Icon - hidden on hover in narrow mode when not checked */}
              <div
                class="flex items-center justify-center group-hover/icon-checkbox:opacity-0 transition-opacity"
                classList={{
                  'opacity-0': props.checked,
                }}
              >
                <Dynamic
                  component={getIcon().icon}
                  class={`flex size-full ${getIcon().foreground}`}
                />
              </div>
            </div>
            {/* Sender Name */}
            <div class="truncate flex items-center gap-1 @max-md/uList:min-w-0">
              <Show
                when={props.entity.type === 'email' && props.entity.isDraft}
              >
                <div class="font-mono font-medium user-select-none uppercase flex items-center text-accent-30 p-0.5 gap-1 text-[0.625rem] rounded-full border border-edge-muted px-2">
                  DRAFT
                </div>
              </Show>
              <span>
                {displayedNames() ??
                  props.entity.senderName ??
                  props.entity.senderEmail?.split('@')[0]}
              </span>
            </div>
            {/* Sender Email Address */}
            {/* <Show
              when={
                props.entity.senderEmail
              }
            >
              <div class="text-accent-ink truncate">{`<${
                props.entity.senderEmail
              }>`}</div>
            </Show> */}
          </div>
          {/* Subject */}
          {/*<ImportantBadge active={props.importantIndicatorActive} />*/}
          <div class="flex items-center w-full gap-2 flex-1 min-w-0 @max-md/uList:flex-col @max-md/uList:items-start @max-md/uList:w-full @max-md/uList:gap-1">
            <div class="flex items-center gap-2 flex-1 min-w-0 @max-md/uList:w-full @max-md/uList:justify-between @max-md/uList:min-w-0">
              <div
                class="shrink-0 truncate @max-md/uList:min-w-0 @max-md/uList:flex-1"
                classList={{
                  'font-regular text-ink-disabled': isSearch(),
                  'font-medium': !isSearch(),
                }}
              >
                <Show when={isSearch()}>
                  <span class="@max-md/uList:hidden"> – </span>
                </Show>
                <Show
                  when={isSearch() && searchHighlightName()}
                  fallback={displayName()}
                >
                  {(name) => (
                    <StaticMarkdown
                      markdown={name()}
                      theme={unifiedListMarkdownTheme}
                      singleLine={true}
                    />
                  )}
                </Show>
              </div>
              {/* Body snippet - inline in wide mode */}
              <div class="truncate shrink grow opacity-60 @max-md/uList:hidden">
                {props.entity.snippet}
              </div>
              {/* Timestamp inline with subject in narrow mode */}
              <Show when={props.timestamp ?? props.entity.updatedAt}>
                {(date) => (
                  <span class="hidden @max-md/uList:inline shrink-0 whitespace-nowrap text-xs touch:mobile-width:text-sm font-mono uppercase text-ink-extra-muted">
                    {createFormattedDate(date())}
                  </span>
                )}
              </Show>
            </div>
            {/* Body snippet - below subject in narrow mode */}
            <div class="hidden @max-md/uList:block truncate w-full text-xs touch:mobile-width:text-sm opacity-60">
              {props.entity.snippet}
            </div>
          </div>
        </div>
      );
    }

    const channelEntity = createMemo(() =>
      props.entity.type === 'channel' ? props.entity : null
    );

    const latestMessage = createMemo(() => channelEntity()?.latestMessage);

    const userNameFromSender = createMemo(() => {
      const senderId = channelEntity()?.latestMessage?.senderId;
      if (!senderId) return;
      const [userName] = useDisplayName(tryMacroId(senderId));
      return userName();
    });

    const showLatestMessageInfo = () => {
      return (
        !props.showUnrollNotifications &&
        props.entity.type === 'channel' &&
        !isSearchEntity(props.entity)
      );
    };

    return (
      <div class="flex gap-2 items-center min-w-0 w-fit max-w-full overflow-hidden @max-md/uList:flex-col @max-md/uList:items-start @max-md/uList:w-full @max-md/uList:gap-1">
        <span class="flex gap-1 truncate font-medium shrink-0 items-center @max-md/uList:w-full @max-md/uList:flex-col @max-md/uList:items-start @max-md/uList:gap-1">
          <div class="flex items-center gap-2 w-full @max-md/uList:justify-between @max-md/uList:min-w-0">
            {/* Icon inline with title in narrow mode */}
            <div class="hidden @max-md/uList:flex size-[1em] shrink-0 items-center justify-center relative group/icon-checkbox-nonemail">
              {/* Checkbox for narrow mode - shown on hover or when checked */}
              <button
                type="button"
                class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/icon-checkbox-nonemail:opacity-100 transition-opacity"
                classList={{
                  'opacity-100': props.checked,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onChecked?.(!props.checked, e.shiftKey);
                }}
                data-blocks-navigation
              >
                <div
                  class="size-[0.875em] flex items-center justify-center rounded-xs border border-edge-muted pointer-events-none"
                  classList={{
                    'bg-accent border-accent': props.checked,
                  }}
                >
                  <Show when={props.checked}>
                    <CheckIcon class="w-full h-full text-panel" />
                  </Show>
                </div>
              </button>
              {/* Icon - hidden on hover in narrow mode when not checked */}
              <div
                class="flex items-center justify-center group-hover/icon-checkbox-nonemail:opacity-0 transition-opacity"
                classList={{
                  'opacity-0': props.checked,
                }}
              >
                <Show
                  when={
                    props.entity.type === 'channel' &&
                    props.entity.channelType === ChannelTypeEnum.DirectMessage
                  }
                  fallback={
                    <Dynamic
                      component={getIcon().icon}
                      class={`flex size-full ${getIcon().foreground}`}
                    />
                  }
                >
                  <DirectMessageIcon entity={props.entity} />
                </Show>
              </div>
            </div>
            <span
              class="font-semibold truncate @max-md/uList:min-w-0 @max-md/uList:flex-1"
              classList={{
                'w-[20cqw]': !props.showUnrollNotifications,
              }}
            >
              <Show
                when={isSearch() && searchHighlightName()}
                fallback={displayName()}
              >
                {(name) => (
                  <StaticMarkdown
                    markdown={name()}
                    theme={unifiedListMarkdownTheme}
                    singleLine={true}
                  />
                )}
              </Show>
            </span>
            {/* Timestamp inline with title in narrow mode */}
            <Show when={props.timestamp ?? props.entity.updatedAt}>
              {(date) => (
                <span class="hidden @max-md/uList:inline shrink-0 whitespace-nowrap text-xs touch:mobile-width:text-sm font-mono uppercase text-ink-extra-muted">
                  {createFormattedDate(date())}
                </span>
              )}
            </Show>
          </div>

          <Show when={showLatestMessageInfo()}>
            <div class="flex items-center gap-1 @max-md/uList:w-full @max-md/uList:flex-col @max-md/uList:items-start @max-md/uList:gap-1">
              {/*<ImportantBadge active={props.importantIndicatorActive} />*/}
              <span class="font-medium shrink-0 truncate @max-md/uList:w-full">
                {userNameFromSender()}
              </span>
              <Show when={latestMessage()}>
                {(lastMessage) => (
                  <div class="truncate shrink grow opacity-60 flex items-center @max-md/uList:w-full @max-md/uList:text-xs @max-md/uList:touch:mobile-width:text-sm">
                    {/* TODO (seamus): Channels endpoint does not return any information about attachments. If we have an empty message, assume it's attachments.*/}
                    <Show
                      when={lastMessage().content.trim()}
                      fallback={
                        <span class="italic text-ink-disabled">
                          Attached items
                        </span>
                      }
                    >
                      {(content) => (
                        <StaticMarkdown
                          markdown={content()}
                          theme={unifiedListMarkdownTheme}
                          singleLine={true}
                        />
                      )}
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </Show>
        </span>
      </div>
    );
  });

  const { isAltKey } = useDragOperation();
  const operation = createMemo(() => {
    switch (props.entity.type) {
      case 'document':
        return isAltKey() ? 'copy' : 'move';
      case 'chat':
        return isAltKey() ? 'copy' : 'move';
      default:
        return 'move';
    }
  });
  const draggableId = `${props.entity.id}-${props.splitId ?? createUniqueId()}`;
  const dragData: EntityDragData = {
    dragType: 'entity',
    splitId: props.splitId,
    ...props.entity,
    operation,
  };
  const draggable = createDraggable(draggableId, dragData);
  false && draggable;

  // The main click handler for the entity row should navigate to an entity
  // without forcing focus back to the source split until after navigation.
  // Certain buttons in the entity need to NOT Navigate AND return focus to
  // the split. Those buttons should have a 'data-blocks-navigation'
  function blocksNavigation(e: PointerEvent | MouseEvent): boolean {
    const { target } = e;
    if (target instanceof Element) {
      const closest = target.closest('[data-blocks-navigation]');
      if (closest && entityDivRef()?.contains(closest)) return true;
    }
    return false;
  }

  const userId = useUserId();
  const sharedData = () => {
    if (props.entity.type === 'channel') {
      return false;
    }

    if (props.entity.ownerId === userId()) {
      return false;
    }
    return {
      ownerDisplayName: useDisplayName(tryMacroId(props.entity.ownerId))[0],
      ownerId: props.entity.ownerId,
    };
  };

  /**
   * Properties for this entity
   * TODO - @danielkweon: Once endpoint includes properties, remove temp data and use: props.displayProperties ?? []
   */
  const properties = (): Property[] => {
    // Use real properties if provided, otherwise use temp data for testing
    return props.properties ?? [];
  };

  return (
    <div
      use:draggable
      data-checked={props.checked}
      class="everything-entity w-full relative group/entity hover:bg-hover/30 text-sm touch:mobile-width:text-base mx-[1px]"
      style={{
        'min-height': `${ENTITY_HEIGHT}px`,
      }}
      classList={{
        'outline outline-accent/20 outline-offset-[-1px]':
          !isTouchDevice() && props.selected.active && !props.checked,
        '!bg-accent/5 outline outline-accent/20 outline-offset-[-1px]':
          props.checked,
        'bracket outline outline-accent/20 outline-offset-[-1px]':
          !isTouchDevice() && props.selected.active,
        'after:opacity-20 !outline-accent/10':
          !isTouchDevice() && props.selected.active && props.selected.muted,
        'active:bracket active:outline active:outline-accent/20 active:outline-offset-[-1px]':
          isTouchDevice() && !props.checked,
      }}
      onMouseMove={() => {
        if (isTouchDevice()) return;

        setHoveredComponentId(id);
        props.onMouseOver?.();
      }}
      onContextMenu={() => {
        props.onContextMenu?.();
      }}
    >
      <div
        data-entity
        data-entity-id={props.entity.id}
        class="w-full min-w-0 grid flex-1 items-center suppress-css-bracket grid-cols-[2rem_1fr_auto] @max-md/uList:flex @max-md/uList:flex-col pr-2 @max-md/uList:px-2 @max-md/uList:py-2"
        onClick={(e) => {
          if (blocksNavigation(e)) return;
          props.onClick?.({ type: 'entity', entity: props.entity, event: e });
        }}
        onDblClick={(e) => {
          if (blocksNavigation(e)) return;
          props.onDblClick?.({
            type: 'entity',
            entity: props.entity,
            event: e,
          });
        }}
        onMouseDown={(e) => {
          if (blocksNavigation(e)) return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          if (blocksNavigation(e)) return;
          props.onPointerDown?.({
            type: 'entity',
            entity: props.entity,
            event: e,
          });
        }}
        // Action List is also rendered based on focus, but when focused via Shift+Tab, parent is focused due to Action List dom not present. Here we check if current browser task has captured Shift+Tab focus on Action List
        onFocusIn={(e) => {
          if (
            !(
              keydownDataDuringTask().pressedShiftTab &&
              !e.currentTarget.contains(keydownDataDuringTask().target)
            )
          ) {
            return;
          }

          actionButtonRef()?.focus();
        }}
        role="button"
        tabIndex={0}
        ref={mergeRefs(setEntityDivRef, props.ref)}
      >
        <button
          type="button"
          class="col-1 size-full relative group/button flex items-center justify-center bracket-never @max-md/uList:hidden touch:hidden"
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            props.onChecked?.(!props.checked, e.shiftKey);
          }}
          data-blocks-navigation
        >
          <div
            class="size-4 p-0.5 flex items-center justify-center rounded-xs group-hover/button:border-accent group-hover/button:border pointer-events-none"
            classList={{
              'ring ring-edge-muted': props.highlighted,
              'bg-panel': !props.checked && props.highlighted,
              'bg-accent border border-accent': props.checked,
            }}
          >
            <Show when={props.checked}>
              <CheckIcon class="w-full h-full text-panel" />
            </Show>
          </div>
          <Show
            when={
              props.showLeftColumnIndicator &&
              !props.checked &&
              !props.highlighted
            }
          >
            <div class="absolute inset-0 flex items-center justify-center group-hover/button:opacity-0 @max-md/uList:hidden">
              <UnreadIndicator active={props.unreadIndicatorActive} />
            </div>
          </Show>
        </button>
        {/* Left Column Indicator(s) */}
        {/* Icon and name - top left on mobile, first item on desktop */}
        <div
          class="min-h-10 min-w-[50px] flex flex-row items-center gap-2 col-2 @max-md/uList:col-auto @max-md/uList:w-full @max-md/uList:min-h-0 @max-md/uList:items-start"
          classList={{
            grow: props.contentPlacement === 'bottom-row',
          }}
        >
          {/* When the left checkbox column is hidden in narrow split containers, we still want
              unread indicators to be visible. */}
          <Show when={props.showLeftColumnIndicator && !props.checked}>
            <div
              class="flex size-4 items-center justify-center @min-md/split:hidden"
              classList={{
                invisible: props.highlighted,
              }}
            >
              <UnreadIndicator active={props.unreadIndicatorActive} />
            </div>
          </Show>
          {/* Icon/Checkbox container - in narrow mode, shows icon by default, checkbox on hover */}
          {/* For emails, icon is inline with sender, so hide this container in narrow mode */}
          <div class="flex size-5 shrink-0 items-center justify-center relative group/icon-checkbox @max-md/uList:hidden">
            {/* Checkbox for narrow mode - shown on hover or when checked, hidden at larger widths */}
            <button
              type="button"
              class="hidden @max-md/uList:flex @min-md/uList:hidden absolute inset-0 items-center justify-center opacity-0 group-hover/icon-checkbox:opacity-100 transition-opacity"
              classList={{
                'opacity-100': props.checked,
              }}
              onClick={(e) => {
                e.stopPropagation();
                props.onChecked?.(!props.checked, e.shiftKey);
              }}
              data-blocks-navigation
            >
              <div
                class="size-4 p-0.5 flex items-center justify-center rounded-xs border border-edge-muted pointer-events-none"
                classList={{
                  'bg-accent border-accent': props.checked,
                }}
              >
                <Show when={props.checked}>
                  <CheckIcon class="w-full h-full text-panel" />
                </Show>
              </div>
            </button>
            {/* Icon - hidden on hover in narrow mode when not checked */}
            <div
              class="flex items-center justify-center @max-md/uList:group-hover/icon-checkbox:opacity-0 @max-md/uList:transition-opacity"
              classList={{
                '@max-md/uList:opacity-0': props.checked,
              }}
            >
              <Show
                when={
                  props.entity.type === 'channel' &&
                  props.entity.channelType === ChannelTypeEnum.DirectMessage
                }
                fallback={
                  <Dynamic
                    component={getIcon().icon}
                    class={`flex size-full ${getIcon().foreground}`}
                  />
                }
              >
                <DirectMessageIcon entity={props.entity} />
              </Show>
            </div>
          </div>
          <EntityTitle />
        </div>
        {/* Date and user - top right on mobile, end on desktop  */}
        <div class="row-1 ml-2 @md:ml-4 self-center min-w-0 col-3 @max-md/uList:col-auto @max-md/uList:row-auto @max-md/uList:ml-0 @max-md/uList:mt-1 @max-md/uList:self-start @max-md/uList:w-full">
          <div class="flex flex-row items-center justify-end gap-2 min-w-0 @max-md/uList:justify-start @max-md/uList:flex-wrap">
            <Show when={sharedData()}>
              {(shared) => (
                <Tooltip
                  tooltip={`${shared().ownerDisplayName()} shared with you`}
                >
                  <SharedBadge ownerId={shared().ownerId} />
                </Tooltip>
              )}
            </Show>
            <Show when={matches(props.entity, isProjectContainedEntity)}>
              {(entity) => (
                <EntityProject
                  entity={entity()}
                  onClick={props.onClick}
                  onPointerdown={props.onPointerDown}
                />
              )}
            </Show>
            <Show when={isTaskEntity(props.entity) && properties().length > 0}>
              <KeyPropertiesGrid
                properties={properties()}
                entityId={props.entity.id}
                entityType="TASK"
              />
            </Show>
            <Show when={props.timestamp ?? props.entity.updatedAt}>
              {(date) => (
                <span class="w-[8ch] text-right shrink-0 whitespace-nowrap text-xs touch:mobile-width:text-sm font-mono uppercase text-ink-extra-muted @max-md/uList:hidden">
                  {createFormattedDate(date())}
                </span>
              )}
            </Show>
            <Show
              when={
                (props.selected.active || hoveredComponentId() === id) &&
                props.onClickRowAction
              }
            >
              <div class="absolute top-1 right-1 items-center flex @max-sm/uList:hidden">
                <Tooltip
                  tooltip={
                    <LabelAndHotKey
                      label="Mark as done"
                      hotkeyToken={TOKENS.entity.action.markDone}
                    />
                  }
                >
                  <button
                    class="bg-panel flex items-center justify-center size-8 border border-edge-muted hover:bg-accent hover:text-panel"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onClickRowAction?.(props.entity, 'done');
                    }}
                    ref={setActionButtonRef}
                    data-blocks-navigation
                  >
                    <CheckIcon class="w-4 h-4 pointer-events-none" />
                  </button>
                </Tooltip>
              </div>
            </Show>
          </div>
        </div>
        {/* Content Hits from Search */}
        <Show when={isSearch() && contentHitData().length > 0}>
          <div class="relative row-2 col-2 col-end-4 pb-2 @max-md/split:row-auto @max-md/split:col-auto @max-md/split:w-full @max-md/split:mt-1">
            <CollapsibleList
              items={contentHitData()}
              threadBorder
              visibleCount={1}
            >
              {(data, index, count) => (
                <ContentHitRow
                  allData={contentHitData()}
                  data={data}
                  onClick={(e, location) => {
                    props.onClick?.({
                      type: 'entity',
                      entity: props.entity,
                      event: e,
                      location,
                    });
                  }}
                  index={index}
                  count={count}
                />
              )}
            </CollapsibleList>
          </div>
        </Show>
        {/* Notifications (stacked by type) */}
        <Show
          when={
            props.showUnrollNotifications &&
            hasNotifications() &&
            contentHitData().length === 0
          }
        >
          <div class="relative col-2 col-end-4 pb-2 @max-md/uList:col-auto @max-md/uList:w-full @max-md/uList:mt-1">
            <CollapsibleList items={stackedNotificationsGroups()} threadBorder>
              {(group) => (
                <StackedNotificationRenderer
                  group={group}
                  onClick={props.onClickNotification}
                  onClickStacked={(args) => {
                    // Navigate to the most recent notification in the stack
                    const mostRecent = getMostRecentNotification(args.group);
                    props.onClickNotification?.({
                      type: 'entity',
                      entity: {
                        ...args.entity,
                        notification: mostRecent,
                        // Attach all notifications in the group for bulk operations
                        stackedNotifications: getAllNotificationsFromGroup(
                          args.group
                        ),
                      },
                      event: args.event,
                    });
                  }}
                  entity={props.entity}
                />
              )}
            </CollapsibleList>
          </div>
        </Show>
      </div>
    </div>
  );
}

function DirectMessageIcon(props: { entity: EntityData }) {
  const userId = useUserId();
  const participantId = () =>
    props.entity.type === 'channel'
      ? (props.entity.participantIds ?? [])
          .filter((id) => id !== userId())
          .at(0)
      : undefined;

  const Fallback = () => <EntityIcon targetType="direct_message" />;

  return (
    <div class="bg-panel size-5 rounded-full p-[2px]">
      <Show when={participantId()} fallback={<Fallback />}>
        {(id) => <UserIcon id={id()} isDeleted={false} size="xs" />}
      </Show>
    </div>
  );
}

function EntityProjectPathDisplay(props: { name: string; path: string[] }) {
  const [displayPath, setDisplayPath] = createSignal<string | undefined>(
    props.name
  );
  const [truncated, setTruncated] = createSignal(false);

  const fullPath = createMemo(() => props.path.join(' / '));

  const getDisplayPath = (): { name: string; truncated: boolean } => {
    const fullPathString = fullPath();
    const maxLength = 30;

    if (fullPathString.length <= maxLength) {
      return { name: fullPathString, truncated: false };
    }

    if (props.path.length === 1) {
      return {
        name: props.path[0].slice(0, maxLength - 3) + '...',
        truncated: true,
      };
    }

    if (props.path.length === 2) {
      const first = props.path[0];
      const last = props.path[props.path.length - 1];
      const combined = `${first} / ... / ${last}`;
      if (combined.length <= maxLength) {
        return { name: combined, truncated: true };
      }
      return {
        name: `${first.slice(0, 10)}... / ${last.slice(0, 10)}...`,
        truncated: true,
      };
    }

    const first = props.path[0];
    const last = props.path[props.path.length - 1];
    return { name: `${first} / ... / ${last}`, truncated: true };
  };

  createDeferred(() => {
    const { name, truncated } = getDisplayPath();
    setDisplayPath(name);
    setTruncated(truncated);
  });

  return (
    <Tooltip tooltip={fullPath()} hide={!truncated()}>
      <div class="truncate">{displayPath()}</div>
    </Tooltip>
  );
}

function EntityProject(props: {
  entity: ProjectContainedEntity;
  onClick?: EntityClickHandler<ProjectEntity>;
  onPointerdown?: EntityPointerDownHandler<ProjectEntity>;
}) {
  const projectQuery = createProjectQuery(props.entity.projectId);
  const openProjectEntity: (args: {
    event: Parameters<JSX.EventHandler<HTMLDivElement, MouseEvent>>[number];
    eventHandler?: EntityClickHandler<ProjectEntity>;
  }) => void = ({ event, eventHandler }) => {
    if (!projectQuery.isSuccess) return;

    const data = projectQuery.data;
    const projectEntity: ProjectEntity = {
      type: 'project',
      id: data.id,
      name: data.name,
      ownerId: data.owner,
      updatedAt: data.updatedAt,
    };
    eventHandler?.({
      type: 'entity-project-path',
      entity: props.entity as unknown as ProjectEntity,
      projectEntity,
      event,
    });
  };

  return (
    <div
      data-blocks-navigation={projectQuery.isSuccess ? 'true' : undefined}
      onClick={(e) =>
        openProjectEntity({ event: e, eventHandler: props.onClick })
      }
      onPointerDown={(e) =>
        openProjectEntity({ event: e, eventHandler: props.onPointerdown })
      }
      class="flex gap-1 items-center text-xs touch:mobile-width:text-sm text-ink-extra-muted min-w-0"
      classList={{
        'hover:text-accent': projectQuery.isSuccess,
      }}
    >
      <svg
        class="shrink-0"
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
      >
        <path
          d="M15.1875 5.0625H9.18773L7.23727 3.6C7.04225 3.45449 6.80558 3.3756 6.56227 3.375H2.8125C2.51413 3.375 2.22798 3.49353 2.017 3.7045C1.80603 3.91548 1.6875 4.20163 1.6875 4.5V14.0625C1.6875 14.3609 1.80603 14.647 2.017 14.858C2.22798 15.069 2.51413 15.1875 2.8125 15.1875H15.2501C15.5317 15.1871 15.8018 15.0751 16.0009 14.8759C16.2001 14.6768 16.3121 14.4067 16.3125 14.1251V6.1875C16.3125 5.88913 16.194 5.60298 15.983 5.392C15.772 5.18103 15.4859 5.0625 15.1875 5.0625ZM15.1875 14.0625H2.8125V4.5H6.56227L8.6625 6.075C8.75987 6.14803 8.87829 6.1875 9 6.1875H15.1875V14.0625Z"
          fill="currentColor"
        />
      </svg>
      <Suspense
        fallback={<div class="h-3 w-10 bg-ink-placeholder animate-pulse" />}
      >
        <Show when={projectQuery.data}>
          {(data) => (
            <EntityProjectPathDisplay name={data().name} path={data().path} />
          )}
        </Show>
      </Suspense>
    </div>
  );
}

const trackKeydownDuringTask = () => {
  // data captured during shift tab keydown event, data is only kept for that browser task then emptied
  const [keydownDataDuringTask, setKeydownDataDuringTask] = createSignal<{
    pressedShiftTab: boolean;
    pressedAnyKey: boolean;
    target: HTMLElement | null;
  }>({
    pressedShiftTab: false,
    pressedAnyKey: false,
    target: null,
  });
  const hasShiftTabbedEvent = (e: KeyboardEvent) => {
    if (!(e.key === 'Tab' && e.shiftKey)) return;
    setKeydownDataDuringTask({
      pressedAnyKey: !!e.key,
      pressedShiftTab: true,
      target: e.target as HTMLElement,
    });

    setTimeout(() => {
      setKeydownDataDuringTask({
        pressedShiftTab: false,
        target: null,
        pressedAnyKey: false,
      });
    });
  };

  onMount(() => {
    document.addEventListener('keydown', hasShiftTabbedEvent);

    onCleanup(() => {
      document.removeEventListener('keydown', hasShiftTabbedEvent);
    });
  });

  return { keydownDataDuringTask };
};

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const createFormattedDate = (timestamp: number) => {
  const ts = timestamp < 1e12 ? timestamp * 1000 : timestamp;

  const date = new Date(ts);
  const now = new Date();

  const dateDay = startOfDay(date);
  const todayDay = startOfDay(now);

  // Today → show time
  if (dateDay === todayDay) {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Same year → show Month Day
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  // Older → show numeric date
  return date.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  });
};
