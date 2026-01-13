import { EntityIcon } from '@core/component/EntityIcon';
import type { Property } from '@core/component/Properties/types';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { matches } from '@core/util/match';
import CheckIcon from '@icon/regular/check.svg';
import { tryToTypedNotification } from '@notifications';
import { useEmail, useUserId } from '@service-gql/client';
import { syncServiceClient } from '@service-sync/client';
import { mergeRefs } from '@solid-primitives/refs';
import { createDraggable, createDroppable } from '@thisbeyond/solid-dnd';
import { getIconConfig } from 'core/component/EntityIcon';
import { StaticMarkdown } from 'core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from 'core/component/LexicalMarkdown/theme';
import { UserIcon } from 'core/component/UserIcon';
import { emailToMacroId, tryMacroId, useDisplayName } from 'core/user';
import type { ParentProps, Ref } from 'solid-js';
import {
  createDeferred,
  createEffect,
  createMemo,
  createSignal,
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
import {
  type EntityData,
  isTaskEntity,
  type ProjectEntity,
} from '../types/entity';
import type { Notification, WithNotification } from '../types/notification';
import type {
  ChannelContentHitData,
  ContentHitData,
  EmailContentHitData,
  SearchLocation,
  WithSearch,
} from '../types/search';
import type { EntityClickEvent, EntityClickHandler } from './Entity';
import { KeyPropertiesGrid, PropertyPills } from './PropertyPills';

export const ENTITY_HEIGHT = 40;

function UnreadIndicator(props: { active?: boolean }) {
  return (
    <div class="flex size-4 items-center justify-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        classList={{
          'fill-accent': true,
          'opacity-0': !props.active,
        }}
        viewBox="0 0 8 8"
        width="75%"
        height="75%"
        fill="none"
      >
        <path d="M3.39622 8C3.29136 8 3.23894 7.94953 3.23894 7.84858L3.33068 5.13565L0.932129 6.58675C0.836012 6.63722 0.76174 6.6204 0.709312 6.53628L0.0801831 5.56467C0.0190178 5.47213 0.0364936 5.40063 0.132611 5.35016L2.58359 4.07571L0.09329 2.88959C-0.00282696 2.83912 -0.0246717 2.77182 0.0277557 2.6877L0.59135 1.58991C0.643778 1.49737 0.71805 1.47634 0.814167 1.52681L3.31758 2.95268L3.21272 0.151421C3.21272 0.0504735 3.26515 0 3.37 0H4.57583C4.68069 0 4.73312 0.0504735 4.73312 0.151421L4.64137 2.94006L7.14478 1.40063C7.2409 1.34175 7.3108 1.35857 7.35449 1.4511L7.97051 2.46057C8.02294 2.5531 8.00546 2.6204 7.91808 2.66246L5.40157 4L7.82633 5.18612C7.91371 5.23659 7.93556 5.30389 7.89187 5.38801L7.36759 6.4858C7.32391 6.58675 7.25837 6.60778 7.17099 6.54889L4.6938 5.13565L4.78554 7.84858C4.79428 7.94953 4.74185 8 4.62826 8H3.39622Z" />
      </svg>
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
    <div class="text-sm text-ink-muted truncate flex items-center">
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
      <div class="flex gap-2 text-sm w-full min-w-0 overflow-hidden items-baseline">
        <div class="text-sm shrink-0 truncate min-w-0 font-medium">
          {userName()}
        </div>
        <div class="shrink-0 font-mono text-xs uppercase text-ink-extra-muted">
          {createFormattedDate(props.data.sentAt)}
        </div>
        <div class="text-sm text-ink-muted truncate flex items-center flex-1 min-w-0">
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
      <div class="flex gap-2 text-sm w-full min-w-0 overflow-hidden items-baseline">
        <Show when={!isSingleMatch() && !isSingleSender()}>
          <div class="text-sm shrink-0 truncate min-w-0 font-medium">
            {props.data.sender}
          </div>
        </Show>
        <Show when={!isSingleMatch() && !isSingleSentAt()}>
          <div class="shrink-0 font-mono text-xs uppercase text-ink-extra-muted">
            {createFormattedDate(props.data.sentAt)}
          </div>
        </Show>
        <div class="text-sm text-ink-muted truncate flex items-center flex-1 min-w-0">
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
            class="block w-fit px-2 py-0.5 text-[10px] border border-edge uppercase font-mono hover:font-medium"
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

    const metadata = tryToTypedNotification(
      props.notification
    )?.notificationMetadata;
    if (
      !metadata ||
      !('messageContent' in metadata) ||
      metadata.messageContent === undefined
    )
      return '';

    return (
      <Show
        when={metadata.messageContent.trim()}
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
              props.onClick?.(
                {
                  ...props.entity,
                  notification: props.notification,
                },
                e
              );
            }
          : undefined
      }
      classList={{
        'opacity-70': props.notification.viewedAt !== null,
      }}
    >
      <div class="flex size-5 shrink-0 items-center justify-center mr-1">
        <UserIcon id={props.notification.senderId!} size="xs" />
      </div>
      <div class="flex gap-1 text-sm w-full min-w-0 overflow-hidden items-baseline">
        <div class="text-sm w-[20cqw] shrink-0 truncate min-w-0">
          {userName()}{' '}
          <span class="opacity-70 uppercase font-mono text-[0.625rem] ml-2">
            {ActionContent()}
          </span>
        </div>
        <MessageContent />
      </div>
      <div class="shrink-0 font-mono text-xs uppercase text-ink-extra-muted ml-2">
        {createFormattedDate(props.notification.createdAt)}
      </div>
    </CollapsibleListRow>
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
                  <span class="font-mono text-xs text-ink-disabled/50">
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
  EntityClickHandler<T & { notification: Notification }>;

interface EntityProps<T extends WithNotification<EntityData>>
  extends ParentProps {
  entity: T;
  focused?: boolean;
  timestamp?: number;
  onClick?: EntityClickHandler<T>;
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
  selected?: boolean;
  ref?: Ref<HTMLDivElement>;
  onChecked?: (checked: boolean, shiftKey?: boolean) => void;
  checked?: boolean;
  searchActive?: boolean;
}

const [hoveredEntityId, setHoveredEntityId] = createSignal<string | null>(null);

export function EntityWithEverything(
  props: EntityProps<WithNotification<EntityData | WithSearch<EntityData>>>
) {
  const [actionButtonRef, setActionButtonRef] =
    createSignal<HTMLButtonElement | null>(null);
  const [entityDivRef, setEntityDivRef] = createSignal<HTMLDivElement | null>(
    null
  );

  const { keydownDataDuringTask } = trackKeydownDuringTask();
  const userEmail = useEmail();

  const getIcon = createMemo(() => {
    switch (props.entity.type) {
      case 'channel':
        switch (props.entity.channelType) {
          case 'direct_message':
            return getIconConfig('directMessage');
          case 'organization':
            return getIconConfig('company');
          default:
            return getIconConfig('channel');
        }
      case 'document':
        if (isTaskEntity(props.entity)) return getIconConfig('task');
        if (props.entity.fileType) return getIconConfig(props.entity.fileType);
        return getIconConfig('default');
      case 'chat':
        return getIconConfig('chat');
      case 'project':
        return getIconConfig('project');
      case 'email':
        return getIconConfig(props.entity.isRead ? 'emailRead' : 'email');
    }
  });

  const hasNotifications = () =>
    !!props.entity.notifications && props.entity.notifications().length > 0;

  const notDoneNotifications = () => {
    const notifications = props.entity.notifications?.();
    if (!notifications) return [];
    return notifications.filter(({ done }) => !done);
  };

  const isSearch = createMemo(
    () => !!props.searchActive && isSearchEntity(props.entity)
  );

  const searchHighlightName = () =>
    isSearchEntity(props.entity) && props.entity.search.nameHighlight;

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
        <div class="flex gap-1 items-center text-sm min-w-0 w-full truncate overflow-hidden @max-md/split:flex-col @max-md/split:items-start @max-md/split:gap-1 @max-md/split:truncate-none">
          {/* sometimes senderName and senderEmail are the same */}
          <div
            class="flex gap-2 items-center font-semibold shrink-0 @max-md/split:w-full @max-md/split:truncate"
            classList={{
              'w-[20cqw]': !isSearch(),
            }}
          >
            {/* Icon inline with sender in narrow mode */}
            <div class="hidden @max-md/split:flex size-[1em] shrink-0 items-center justify-center relative group/icon-checkbox">
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
            <div class="truncate @max-md/split:min-w-0">
              {displayedNames() ??
                props.entity.senderName ??
                props.entity.senderEmail?.split('@')[0]}
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
          <div class="flex items-center w-full gap-2 flex-1 min-w-0 @max-md/split:flex-col @max-md/split:items-start @max-md/split:w-full @max-md/split:gap-1">
            <div class="flex items-center gap-2 flex-1 min-w-0 @max-md/split:w-full @max-md/split:justify-between @max-md/split:min-w-0">
              <div
                class="shrink-0 truncate @max-md/split:min-w-0 @max-md/split:flex-1"
                classList={{
                  'font-regular text-ink-disabled': isSearch(),
                  'font-medium': !isSearch(),
                }}
              >
                <Show when={isSearch()}>
                  <span class="@max-md/split:hidden"> – </span>
                </Show>
                <Show
                  when={isSearch() && searchHighlightName()}
                  fallback={props.entity.name}
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
              <div class="truncate shrink grow opacity-60 @max-md/split:hidden">
                {props.entity.snippet}
              </div>
              {/* Timestamp inline with subject in narrow mode */}
              <Show when={props.timestamp ?? props.entity.updatedAt}>
                {(date) => (
                  <span class="hidden @max-md/split:inline shrink-0 whitespace-nowrap text-xs font-mono uppercase text-ink-extra-muted">
                    {createFormattedDate(date())}
                  </span>
                )}
              </Show>
            </div>
            {/* Body snippet - below subject in narrow mode */}
            <div class="hidden @max-md/split:block truncate w-full text-xs opacity-60">
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
      <div class="flex gap-2 items-center min-w-0 w-fit max-w-full overflow-hidden @max-md/split:flex-col @max-md/split:items-start @max-md/split:w-full @max-md/split:gap-1">
        <span class="flex gap-1 truncate font-medium text-sm shrink-0 items-center @max-md/split:w-full @max-md/split:flex-col @max-md/split:items-start @max-md/split:gap-1">
          <div class="flex items-center gap-2 w-full @max-md/split:justify-between @max-md/split:min-w-0">
            {/* Icon inline with title in narrow mode */}
            <div class="hidden @max-md/split:flex size-[1em] shrink-0 items-center justify-center relative group/icon-checkbox-nonemail">
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
                    props.entity.channelType === 'direct_message'
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
              class="font-semibold truncate @max-md/split:min-w-0 @max-md/split:flex-1"
              classList={{
                'w-[20cqw]': !props.showUnrollNotifications,
              }}
            >
              <Show
                when={isSearch() && searchHighlightName()}
                fallback={props.entity.name}
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
                <span class="hidden @max-md/split:inline shrink-0 whitespace-nowrap text-xs font-mono uppercase text-ink-extra-muted">
                  {createFormattedDate(date())}
                </span>
              )}
            </Show>
          </div>

          <Show when={showLatestMessageInfo()}>
            <div class="flex items-center gap-1 @max-md/split:w-full @max-md/split:flex-col @max-md/split:items-start @max-md/split:gap-1">
              {/*<ImportantBadge active={props.importantIndicatorActive} />*/}
              <span class="font-medium shrink-0 truncate @max-md/split:w-full">
                {userNameFromSender()}
              </span>
              <Show when={latestMessage()}>
                {(lastMessage) => (
                  <div class="truncate shrink grow opacity-60 flex items-center @max-md/split:w-full @max-md/split:text-xs">
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

  const draggable = createDraggable(props.entity.id, props.entity);
  false && draggable;
  const droppable = createDroppable(props.entity.id, props.entity);
  false && droppable;

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
      use:droppable
      data-checked={props.checked}
      class="everything-entity w-full relative group/entity hover:bg-hover/30"
      style={{
        'min-height': `${ENTITY_HEIGHT}px`,
      }}
      classList={{
        'outline outline-accent/20 outline-offset-[-1px]':
          !isTouchDevice() && props.selected && !props.checked,
        '!bg-accent/5 outline outline-accent/20 outline-offset-[-1px]':
          props.checked,
        'bracket outline outline-accent/20 outline-offset-[-1px]':
          !isTouchDevice() && props.selected,
        'active:bracket active:outline active:outline-accent/20 active:outline-offset-[-1px]':
          isTouchDevice() && !props.checked,
      }}
      onMouseMove={() => {
        if (isTouchDevice()) return;

        setHoveredEntityId(props.entity.id);
        props.onMouseOver?.();
      }}
      onContextMenu={() => {
        props.onContextMenu?.();
      }}
    >
      <div
        data-entity
        data-entity-id={props.entity.id}
        class="w-full min-w-0 grid flex-1 items-center suppress-css-bracket grid-cols-[2rem_1fr_auto] @max-md/split:flex @max-md/split:flex-col pr-2 @max-md/split:px-2 @max-md/split:py-2"
        onClick={(e) => {
          if (blocksNavigation(e)) return;
          props.onClick?.(props.entity, e);
        }}
        onMouseDown={(e) => {
          if (blocksNavigation(e)) return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          if (blocksNavigation(e)) return;
          props.onPointerDown?.(props.entity, e);
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
          class="col-1 size-full relative group/button flex items-center justify-center bracket-never @max-md/split:hidden"
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
            <div class="absolute inset-0 flex items-center justify-center group-hover/button:opacity-0 @max-md/split:hidden">
              <UnreadIndicator active={props.unreadIndicatorActive} />
            </div>
          </Show>
        </button>
        {/* Left Column Indicator(s) */}
        {/* Icon and name - top left on mobile, first item on desktop */}
        <div
          class="min-h-10 min-w-[50px] flex flex-row items-center gap-2 col-2 @max-md/split:col-auto @max-md/split:w-full @max-md/split:min-h-0 @max-md/split:items-start"
          classList={{
            grow: props.contentPlacement === 'bottom-row',
            'opacity-70': props.fadeIfRead && !props.unreadIndicatorActive,
          }}
        >
          {/* Icon/Checkbox container - in narrow mode, shows icon by default, checkbox on hover */}
          {/* For emails, icon is inline with sender, so hide this container in narrow mode */}
          <div class="flex size-5 shrink-0 items-center justify-center relative group/icon-checkbox @max-md/split:hidden">
            {/* Checkbox for narrow mode - shown on hover or when checked, hidden at larger widths */}
            <button
              type="button"
              class="hidden @max-md/split:flex @min-md/split:hidden absolute inset-0 items-center justify-center opacity-0 group-hover/icon-checkbox:opacity-100 transition-opacity"
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
              class="flex items-center justify-center @max-md/split:group-hover/icon-checkbox:opacity-0 @max-md/split:transition-opacity"
              classList={{
                '@max-md/split:opacity-0': props.checked,
              }}
            >
              <Show
                when={
                  props.entity.type === 'channel' &&
                  props.entity.channelType === 'direct_message'
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
          <Show when={isTaskEntity(props.entity) && properties().length > 0}>
            <KeyPropertiesGrid properties={properties()} />
          </Show>
        </div>
        {/* Date and user - top right on mobile, end on desktop  */}
        <div
          class="row-1 ml-2 @md:ml-4 self-center min-w-0 col-3 @max-md/split:col-auto @max-md/split:row-auto @max-md/split:ml-0 @max-md/split:mt-1 @max-md/split:self-start @max-md/split:w-full"
          classList={{
            'opacity-50': props.fadeIfRead && !props.unreadIndicatorActive,
          }}
        >
          <div class="flex flex-row items-center justify-end gap-2 min-w-0 @max-md/split:justify-start @max-md/split:flex-wrap">
            <Show when={properties().length > 0}>
              <div class="pr-2 overflow-hidden shrink min-w-0">
                <PropertyPills
                  properties={properties()}
                  excludeKeyProperties={isTaskEntity(props.entity)}
                />
              </div>
            </Show>
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
                <EntityProject entity={entity()} onClick={props.onClick} />
              )}
            </Show>
            <Show when={props.timestamp ?? props.entity.updatedAt}>
              {(date) => (
                <span class="shrink-0 whitespace-nowrap text-xs font-mono uppercase text-ink-extra-muted @max-md/split:hidden">
                  {createFormattedDate(date())}
                </span>
              )}
            </Show>
            <Show
              when={
                (props.selected || hoveredEntityId() === props.entity.id) &&
                props.onClickRowAction
              }
            >
              <div class="absolute top-1 right-1 items-center flex @max-sm/split:hidden">
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
                    props.onClick?.(props.entity, e, location);
                  }}
                  index={index}
                  count={count}
                />
              )}
            </CollapsibleList>
          </div>
        </Show>
        {/* Notifications */}
        <Show
          when={
            props.showUnrollNotifications &&
            hasNotifications() &&
            contentHitData().length === 0
          }
        >
          <div class="relative col-2 col-end-4 pb-2 @max-md/split:col-auto @max-md/split:w-full @max-md/split:mt-1">
            <CollapsibleList items={notDoneNotifications()} threadBorder>
              {(notification) => (
                <NotificationRow
                  notification={notification}
                  onClick={props.onClickNotification}
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

  const Fallback = () => <EntityIcon targetType="directMessage" />;

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
}) {
  const projectQuery = createProjectQuery(props.entity.projectId);
  let projectIconRef!: HTMLDivElement;

  createEffect(() => {
    const click = props.onClick;
    if (!click) return;
    if (!projectQuery.isSuccess) return;

    const data = projectQuery.data;
    const handleClick = (e: EntityClickEvent) => {
      const projectEntity: ProjectEntity = {
        type: 'project',
        id: data.id,
        name: data.name,
        ownerId: data.owner,
        updatedAt: data.updatedAt,
      };
      click(projectEntity, e, undefined, { ignorePreview: true });
    };

    projectIconRef.classList.add('hover:text-accent');
    projectIconRef.dataset.blocksNavigation = 'true';
    projectIconRef.addEventListener('click', handleClick);
    onCleanup(() => {
      projectIconRef.removeEventListener('click', handleClick);
    });
  });

  return (
    <div
      ref={projectIconRef}
      class="flex gap-1 items-center text-xs text-ink-extra-muted min-w-0"
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
