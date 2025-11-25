import { Tooltip } from '@core/component/Tooltip';
import { matches } from '@core/util/match';
import CheckIcon from '@icon/regular/check.svg';
import { notificationWithMetadata } from '@notifications';
import { useEmail, useUserId } from '@service-gql/client';
import { mergeRefs } from '@solid-primitives/refs';
import { createDraggable, createDroppable } from '@thisbeyond/solid-dnd';
import { getIconConfig } from 'core/component/EntityIcon';
import { StaticMarkdown } from 'core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from 'core/component/LexicalMarkdown/theme';
import { UserIcon } from 'core/component/UserIcon';
import { emailToId, useDisplayName } from 'core/user';
import { onKeyDownClick, onKeyUpClick } from 'core/util/click';
import type { ParentProps, Ref } from 'solid-js';
import {
  createDeferred,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createProfilePictureQuery } from '../queries/auth';
import {
  createProjectQuery,
  isProjectContainedEntity,
  type ProjectContainedEntity,
} from '../queries/project';
import { isSearchEntity } from '../queries/search';
import type { EntityData, ProjectEntity } from '../types/entity';
import type { Notification, WithNotification } from '../types/notification';
import type {
  ChannelContentHitData,
  ContentHitData,
  WithSearch,
} from '../types/search';
import type { EntityClickEvent, EntityClickHandler } from './Entity';

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
  const [userName] = useDisplayName(props.data.senderId);
  const formattedDate = createFormattedDate(props.data.sentAt);

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
          {formattedDate()}
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

interface EntityProps<T extends WithNotification<EntityData>>
  extends ParentProps {
  entity: T;
  focused?: boolean;
  timestamp?: number;
  onClick?: EntityClickHandler<T>;
  onClickRowAction?: (entity: T, type: 'done') => void;
  onClickNotification?: EntityClickHandler<T & { notification: Notification }>;
  onMouseOver?: () => void;
  onMouseLeave?: () => void;
  onFocusIn?: () => void;
  onContextMenu?: () => void;
  properties?: Record<string, string>;
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
}

export function EntityWithEverything(
  props: EntityProps<WithNotification<EntityData | WithSearch<EntityData>>>
) {
  const [actionButtonRef, setActionButtonRef] =
    createSignal<HTMLButtonElement | null>(null);
  const [entityDivRef, setEntityDivRef] = createSignal<HTMLDivElement | null>(
    null
  );
  const [showRestOfNotifications, setShowRestOfNotifications] =
    createSignal(false);

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
        return getIconConfig(props.entity.fileType || 'default');
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

  const threadGap = 6;
  const ThreadBorder = () => (
    <div
      class="absolute left-[calc(0.5rem+1px)] w-[1px] border-l border-edge-muted -top-0.75"
      style={{ height: `${threadGap}px` }}
    />
  );

  const notDoneNotifications = () => {
    let notifications = props.entity.notifications?.();
    if (!notifications) return [];

    if (!showRestOfNotifications()) {
      notifications = notifications.slice(0, 3);
    }

    return notifications.filter(({ done }) => !done);
  };

  const searchHighlightName = () =>
    isSearchEntity(props.entity) && props.entity.search.nameHighlight;

  const contentHitData = () => {
    if (!isSearchEntity(props.entity)) return [];
    return props.entity.search.contentHitData ?? [];
  };

  const EntityTitle = () => {
    if (props.entity.type === 'email') {
      const macroDisplayNames =
        props.entity.participantEmails?.map((email) => {
          return useDisplayName(emailToId(email))[0];
        }) ?? [];
      const isLikelyEmail = (value?: string) =>
        typeof value === 'string' && value.includes('@');
      const combinedParticipantFirstNames = createMemo(() => {
        if (props.entity.type !== 'email') return [];
        const me = userEmail();
        const participantNames = props.entity.participantNames ?? [];
        return (
          props.entity.participantEmails?.reduce<string[]>(
            (acc, email, idx) => {
              if (me && email === me) return acc;
              const macroFirstName = macroDisplayNames[idx]?.().split(' ')[0];
              const participantFirstName = participantNames[idx].split(' ')[0];
              if (macroFirstName && !isLikelyEmail(macroFirstName)) {
                acc.push(macroFirstName);
              } else if (
                isLikelyEmail(macroFirstName) &&
                participantFirstName &&
                !isLikelyEmail(participantFirstName)
              ) {
                acc.push(participantFirstName);
              } else {
                acc.push(email.split('@')[0]);
              }
              return acc;
            },
            []
          ) ?? []
        );
      });

      const displayedNames = () => {
        const names = combinedParticipantFirstNames();
        if (names.length <= 3 && names.length > 0) return names.join(', ');
        if (names.length > 3)
          return `${names[0]} .. ${names[names.length - 2]}, ${names[names.length - 1]}`;
        return undefined;
      };

      return (
        <div class="flex gap-1 items-center text-sm min-w-0 w-full truncate overflow-hidden">
          {/* sometimes senderName and senderEmail are the same */}
          <div class="flex w-[20cqw] gap-2 font-semibold shrink-0">
            {/* Sender Name */}
            <div class="truncate">
              {displayedNames() ?? props.entity.senderName}
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
          <div class="flex items-center w-full gap-4 flex-1 min-w-0">
            <div class="font-medium shrink-0 truncate">
              <Show when={searchHighlightName()} fallback={props.entity.name}>
                {(name) => (
                  <StaticMarkdown
                    markdown={name()}
                    theme={unifiedListMarkdownTheme}
                    singleLine={true}
                  />
                )}
              </Show>
            </div>
            {/* Body  */}
            <div class="truncate shrink grow opacity-60">
              {props.entity.snippet}
            </div>
          </div>
        </div>
      );
    }

    const channelEntity = createMemo(() =>
      props.entity.type === 'channel' ? props.entity : null
    );

    const latestMessageContent = createMemo(
      () => channelEntity()?.latestMessage?.content
    );

    const userNameFromSender = createMemo(() => {
      const senderId = channelEntity()?.latestMessage?.senderId;
      if (!senderId) return;
      const [userName] = useDisplayName(senderId);
      return userName();
    });

    const showLatestMessageInfo = () => {
      return (
        !props.showUnrollNotifications &&
        props.entity.type === 'channel' &&
        !isSearchEntity(props.entity) &&
        !!props.entity.latestMessage?.content
      );
    };

    return (
      <div class="flex gap-2 items-center min-w-0 w-fit max-w-full overflow-hidden">
        <span class="flex gap-1 truncate font-medium text-sm shrink-0 items-center">
          <span
            class="font-semibold truncate"
            classList={{
              'w-[20cqw]': !props.showUnrollNotifications,
            }}
          >
            <Show when={searchHighlightName()} fallback={props.entity.name}>
              {(name) => (
                <StaticMarkdown
                  markdown={name()}
                  theme={unifiedListMarkdownTheme}
                  singleLine={true}
                />
              )}
            </Show>
          </span>

          <Show when={showLatestMessageInfo()}>
            <div class="flex items-center gap-1">
              {/*<ImportantBadge active={props.importantIndicatorActive} />*/}
              <span class="font-medium shrink-0 truncate">
                {userNameFromSender()}
              </span>
            </div>
            <Show when={latestMessageContent()}>
              {(lastMessageContent) => (
                <div class="truncate shrink grow opacity-60 flex items-center">
                  <StaticMarkdown
                    markdown={lastMessageContent()}
                    theme={unifiedListMarkdownTheme}
                    singleLine={true}
                  />
                </div>
              )}
            </Show>
          </Show>
        </span>
      </div>
    );
  };

  const draggable = createDraggable(props.entity.id, props.entity);
  false && draggable;
  const droppable = createDroppable(props.entity.id, props.entity);
  false && droppable;

  const { didCursorMove } = useCursorMove();

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
      ownerDisplayName: useDisplayName(props.entity.ownerId)[0],
      ownerId: props.entity.ownerId,
    };
  };

  return (
    <div
      use:draggable
      use:droppable
      data-checked={props.checked}
      class="everything-entity relative group/entity"
      classList={{
        'bg-hover/30': props.highlighted && !props.checked,
        'bg-accent/5': props.checked,
        'bracket outline outline-accent/20 outline-offset-[-1px]':
          props.selected,
      }}
      onMouseOver={(e) => {
        if (!didCursorMove(e)) {
          return;
        }
        props.onMouseOver?.();
      }}
      onContextMenu={() => {
        props.onContextMenu?.();
      }}
    >
      <div
        data-entity
        data-entity-id={props.entity.id}
        class="w-full min-w-0 grid flex-1 items-center suppress-css-bracket grid-cols-[2rem_1fr_auto] pr-2"
        onClick={(e) => {
          if (blocksNavigation(e)) return;
          props.onClick?.(props.entity, e);
        }}
        onMouseDown={(e) => {
          if (blocksNavigation(e)) return;
          e.preventDefault();
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
        onKeyDown={onKeyDownClick((e) =>
          props.onClick?.(props.entity, e as any)
        )}
        onKeyUp={onKeyUpClick((e) => props.onClick?.(props.entity, e as any))}
        role="button"
        tabIndex={0}
        ref={mergeRefs(setEntityDivRef, props.ref)}
      >
        <button
          type="button"
          class="col-1 size-full relative group/button flex items-center justify-center bracket-never"
          onClick={(e) => {
            props.onChecked?.(!props.checked, e.shiftKey);
          }}
          data-blocks-navigation
        >
          <div
            class="size-4 p-0.5 flex items-center justify-center rounded-xs group-hover/button:border-accent group-hover/button:border pointer-events-none"
            classList={{
              'ring ring-edge-muted': props.selected,
              'bg-panel': !props.checked && props.selected,
              'bg-accent border border-accent': props.checked,
            }}
          >
            <Show when={props.checked}>
              <CheckIcon class="w-full h-full text-panel" />
            </Show>
          </div>
          <Show when={props.showLeftColumnIndicator && !props.checked}>
            <div class="absolute inset-0 flex items-center justify-center -z-1">
              <UnreadIndicator active={props.unreadIndicatorActive} />
            </div>
          </Show>
        </button>
        {/* Left Column Indicator(s) */}
        {/* Icon and name - top left on mobile, first item on desktop */}
        <div
          class="min-h-10 min-w-[50px] flex flex-row items-center gap-2 col-2"
          classList={{
            grow: props.contentPlacement === 'bottom-row',
            'opacity-70': props.fadeIfRead && !props.unreadIndicatorActive,
          }}
        >
          <div class="flex size-5 shrink-0 items-center justify-center">
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
          <EntityTitle />
        </div>
        {/* Date and user - top right on mobile, end on desktop  */}
        <div
          class="row-1 ml-2 @md:ml-4 self-center min-w-0 col-3"
          classList={{
            'opacity-50': props.fadeIfRead && !props.unreadIndicatorActive,
          }}
        >
          <div class="flex flex-row items-center justify-end gap-2 min-w-0">
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
              {(date) => {
                const formattedDate = createFormattedDate(date());
                return (
                  <span class="shrink-0 whitespace-nowrap text-xs font-mono uppercase text-ink-extra-muted">
                    {formattedDate()}
                  </span>
                );
              }}
            </Show>
            <Show when={props.highlighted}>
              <div class="absolute top-1 right-1 items-center flex">
                <Tooltip tooltip="Mark as done">
                  <button
                    class="bg-panel flex items-center justify-center size-8 border border-edge-muted hover:bg-accent hover:text-panel"
                    onClick={() => {
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
        <Show when={contentHitData().length > 0}>
          <div class="relative row-2 grid gap-2 col-2 col-end-4 pb-2">
            <For each={contentHitData()}>
              {(data) => (
                <Show
                  when={data.type === 'channel' && data}
                  fallback={<GenericContentHit data={data} />}
                >
                  {(data) => <ChannelMessageContentHit data={data()} />}
                </Show>
              )}
            </For>
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
          <div class="relative col-2 col-end-4 200 pb-2 gap-2">
            <For each={notDoneNotifications()}>
              {(notification) => {
                const [userName] = useDisplayName(notification.senderId);

                const formattedDate = createFormattedDate(
                  notification.createdAt
                );

                const ActionContent = () => {
                  if (
                    notification.notificationEventType === 'document_mention' ||
                    notification.notificationEventType ===
                      'channel_message_document'
                  ) {
                    return 'shared';
                  }

                  const metadata =
                    notificationWithMetadata(
                      notification
                    )?.notificationMetadata;
                  if (
                    !metadata ||
                    !('messageContent' in metadata) ||
                    !metadata.messageContent
                  )
                    return '';

                  return 'message';
                };

                const MessageContent = () => {
                  if (
                    notification.notificationEventType === 'document_mention' ||
                    notification.notificationEventType ===
                      'channel_message_document'
                  ) {
                    return '';
                  }

                  const metadata =
                    notificationWithMetadata(
                      notification
                    )?.notificationMetadata;
                  if (
                    !metadata ||
                    !('messageContent' in metadata) ||
                    !metadata.messageContent
                  )
                    return '';

                  return (
                    <StaticMarkdown
                      markdown={metadata.messageContent}
                      theme={unifiedListMarkdownTheme}
                      singleLine={true}
                    />
                  );
                };

                return (
                  <div
                    class="relative flex gap-1 items-center min-w-0 h-8"
                    classList={{
                      'hover:bg-hover/20 hover:opacity-70':
                        !!props.onClickNotification,
                      'opacity-70': notification.viewedAt !== null,
                    }}
                    onClick={
                      props.onClickNotification
                        ? [
                            props.onClickNotification,
                            {
                              ...props.entity,
                              notification,
                            },
                          ]
                        : undefined
                    }
                  >
                    <ThreadBorder />
                    <div class="flex size-5 shrink-0 items-center justify-center mr-1">
                      <NotificationUserIcon id={notification.senderId!} />
                    </div>
                    <div class="flex gap-2 text-sm w-full min-w-0 overflow-hidden items-baseline">
                      <div class="text-sm w-[20cqw] shrink-0 truncate min-w-0">
                        {userName()}{' '}
                        <span class="opacity-70 uppercase font-mono text-[0.625rem] mx-2">
                          {ActionContent()}
                        </span>
                      </div>
                      {/*<ImportantBadge
                        active={
                          notification.viewedAt === null &&
                          notification.isImportantV0
                        }
                      />*/}
                      <MessageContent />
                    </div>
                    <div class="shrink-0 font-mono text-xs uppercase text-ink-extra-muted ml-2">
                      {formattedDate()}
                    </div>
                  </div>
                );
              }}
            </For>
            <Show
              when={
                hasNotifications() &&
                (props.entity.notifications?.().length ?? 0) > 3
              }
            >
              <div class="relative h-5">
                <ThreadBorder />
                <button
                  class="block w-fit px-2 py-0.5 text-[10px] border border-edge uppercase font-mono hover:font-medium"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowRestOfNotifications((prev) => !prev);
                  }}
                  data-blocks-navigation
                >
                  <Show
                    when={!showRestOfNotifications()}
                    fallback={<>Collapse</>}
                  >
                    + {(props.entity.notifications?.().length ?? 0) - 3} More
                  </Show>
                </button>
              </div>
            </Show>
            {/* <div class="relative h-4">
            <ThreadBorder />
            <button class="block p-1 py-0 text-[10px] h-4 border border-edge uppercase font-mono">
              + 6 more
            </button>
          </div> */}
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
      ? (props.entity.particpantIds ?? []).filter((id) => id !== userId()).at(0)
      : undefined;

  const Fallback = () => (
    <Dynamic
      component={getIconConfig('directMessage').icon}
      class={`flex size-full ${getIconConfig('directMessage').foreground}`}
    />
  );

  return (
    <div class="bg-panel size-5 rounded-full p-[2px]">
      <Show when={participantId()} fallback={<Fallback />}>
        {(id) => <UserIcon id={id()} isDeleted={false} size="xs" />}
      </Show>
    </div>
  );
}

function NotificationUserIcon(props: { id: string; name?: string }) {
  const fallbackName = () => props.name || props.id.replace('macro|', '');
  const Fallback = () => (
    <span class="flex size-4 items-center justify-center rounded-full bg-ink-extra-muted">
      <span class="font-medium text-[7px] text-white">
        {fallbackName().charAt(0).toUpperCase()}
      </span>
    </span>
  );

  if (!props.id.startsWith('macro|')) return <Fallback />;

  const profilePicQuery = createProfilePictureQuery(props.id);
  const Loading = () => (
    <div class="flex size-4 animate-pulse rounded-full bg-ink-extra-muted" />
  );
  return (
    <Suspense fallback={<Loading />}>
      <Show when={profilePicQuery.data?.url} fallback={<Fallback />}>
        {(url) => <img src={url()} class="inline-block size-4 rounded-full" />}
      </Show>
    </Suspense>
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
  const projectQuery = createProjectQuery(props.entity);
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
      click(projectEntity, e, { ignorePreview: true });
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

const createFormattedDate = (timestamp: number) =>
  createMemo(() => {
    if (timestamp < 1e12) {
      timestamp *= 1000;
    }
    const date = new Date(timestamp);
    const currentDate = new Date();
    if (date.getDate() === currentDate.getDate()) {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    if (date.getFullYear() === currentDate.getFullYear()) {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    }

    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
    });
  });

let lastMouseX: number | null = null;
let lastMouseY: number | null = null;
let initialMouseMove: boolean = false;
let cursorInit = true;

const useCursorMove = () => {
  const didCursorMove = (event: MouseEvent) => {
    if (!initialMouseMove) return;
    const { clientX, clientY } = event;
    // If the mouse hasn't moved, ignore the event
    if (clientX === lastMouseX && clientY === lastMouseY) {
      return false;
    }

    // Update the last known position
    lastMouseX = clientX;
    lastMouseY = clientY;

    return true;
  };

  const moveEvent = (event: MouseEvent) => {
    const { clientX, clientY } = event;
    initialMouseMove = true;

    setTimeout(() => {
      lastMouseX = clientX;
      lastMouseY = clientY;
    });
  };
  onMount(() => {
    if (!cursorInit) {
      return;
    }
    cursorInit = false;
    document.addEventListener('mousemove', moveEvent, { capture: true });
  });
  return { didCursorMove };
};
