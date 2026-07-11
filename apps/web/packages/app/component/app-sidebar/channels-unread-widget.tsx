import {
  CollapsibleSidebarSection,
  type CollapsibleSidebarSectionItem,
} from '@app/component/app-sidebar/collapsible-sidebar-section';
import type { SidebarState } from '@app/component/app-sidebar/sidebar';
import { useSenderName } from '@app/component/app-sidebar/utils';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToChannelMessage } from '@block-channel/utils/link';
import { ReadonlyThread } from '@channel/StandaloneThread';
import {
  ContextMenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { compareDateDesc } from '@core/util/date';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { openNotification } from '@notifications';
import { isChannelNotification } from '@notifications/notification-helpers';
import { getChannelNotificationParams } from '@notifications/notification-navigation';
import type { UnifiedNotification } from '@notifications/types';
import { cn, Dropdown, NavRow, Surface, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onMount,
  type ParentProps,
  Show,
} from 'solid-js';

function getChannelInfo(notification: UnifiedNotification): {
  channelName: string | null;
  channelType: string | null;
  isDM: boolean;
} {
  if (!isChannelNotification(notification)) {
    return { channelName: null, channelType: null, isDM: false };
  }

  const meta = notification.notification_metadata;
  const channelType = meta.content.channelType;
  const isDM = channelType === 'directMessage';
  const channelName =
    'channelName' in meta.content ? (meta.content.channelName ?? null) : null;
  return { channelName, channelType, isDM };
}

interface ChannelGroup {
  entityId: string;
  channelName: string | null;
  channelType: string | null;
  isDM: boolean;
  notifications: UnifiedNotification[];
  latestSenderId: string | null;
}

function groupByChannel(
  notifications: UnifiedNotification[]
): Map<string, ChannelGroup> {
  const groups = new Map<string, ChannelGroup>();

  for (const notification of notifications) {
    if (!isChannelNotification(notification)) continue;

    const entityId = notification.entity_id;
    const info = getChannelInfo(notification);

    if (!groups.has(entityId)) {
      groups.set(entityId, {
        entityId,
        channelName: info.channelName,
        channelType: info.channelType,
        isDM: info.isDM,
        notifications: [],
        latestSenderId: null,
      });
    }

    const group = groups.get(entityId)!;
    group.notifications.push(notification);

    // Track latest sender for DMs
    if (info.isDM && notification.sender_id) {
      group.latestSenderId = notification.sender_id;
    }
  }

  return groups;
}

const HOVER_PREVIEW_COUNT = 3;

// Unique thread roots (a reply previews its whole thread), newest first.
function getPreviewThreadRoots(group: ChannelGroup): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const notification of group.notifications) {
    const { messageId, threadId } = getChannelNotificationParams(notification);
    const rootId = threadId ?? messageId;
    if (!rootId || seen.has(rootId)) continue;
    seen.add(rootId);
    roots.push(rootId);
  }
  return roots;
}

function GroupHoverPreview(props: { group: ChannelGroup }) {
  const orchestrator = useGlobalBlockOrchestrator();
  const roots = () => getPreviewThreadRoots(props.group);
  // Show the latest few threads oldest → newest, like the channel reads.
  const visible = () => roots().slice(0, HOVER_PREVIEW_COUNT).reverse();
  const hiddenCount = () => roots().length - visible().length;

  return (
    <div class="w-90 min-h-12 max-h-96 overflow-y-auto overscroll-contain flex flex-col py-1">
      <Show when={hiddenCount() > 0}>
        <span class="px-3 py-1 text-xs text-ink-extra-muted">
          +{hiddenCount()} earlier
        </span>
      </Show>
      <For each={visible()}>
        {(rootMessageId) => (
          <ReadonlyThread
            channelId={props.group.entityId}
            messageId={rootMessageId}
            onClickMessage={(clickedMessageId, e) => {
              e.stopPropagation();
              const isReply = clickedMessageId !== rootMessageId;
              navigateToChannelMessage(
                orchestrator,
                props.group.entityId,
                clickedMessageId,
                isReply ? rootMessageId : undefined
              );
            }}
          />
        )}
      </For>
    </div>
  );
}

function UnreadHoverCard(
  props: ParentProps<{
    group: ChannelGroup;
    disabled?: boolean;
    onOpenChange?: (open: boolean) => void;
  }>
) {
  const [hovered, setHovered] = createSignal(false);
  const open = () => hovered() && !props.disabled;

  createEffect(() => props.onOpenChange?.(open()));

  return (
    <Show when={!isTouchDevice()} fallback={props.children}>
      <KobalteTooltip
        open={open()}
        onOpenChange={setHovered}
        placement="right"
        overflowPadding={16}
        fitViewport={true}
        closeDelay={250}
        openDelay={1000}
        flip={true}
        gutter={4}
      >
        <KobalteTooltip.Trigger
          class="inline-flex items-center w-full"
          as="div"
        >
          {props.children}
        </KobalteTooltip.Trigger>
        <KobalteTooltip.Portal>
          <KobalteTooltip.Content class="z-tool-tip max-w-[calc(100vw-32px)] menu-open-animation">
            <Surface depth={3}>
              <GroupHoverPreview group={props.group} />
            </Surface>
          </KobalteTooltip.Content>
        </KobalteTooltip.Portal>
      </KobalteTooltip>
    </Show>
  );
}

function ChannelGroupItem(props: {
  group: ChannelGroup;
  animate?: boolean;
  isSlim?: boolean;
  onFloatingOpenChange?: (open: boolean) => void;
}) {
  const notificationSource = useGlobalNotificationSource();
  const [isVisible, setIsVisible] = createSignal(!props.animate);

  onMount(() => {
    if (props.animate) {
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    }
  });

  const senderName = useSenderName(props.group.latestSenderId);
  const count = () => props.group.notifications.length;

  const isDM = () => props.group.isDM;
  const senderId = () => props.group.latestSenderId;

  const displayName = () => {
    if (props.group.isDM) {
      return senderName() ?? 'Direct Message';
    }
    return props.group.channelName ?? 'Unknown Channel';
  };

  const latestNotification = () => props.group.notifications[0];

  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? false;

  const navigateToLatestNotification = (newSplit = false) => {
    const manager = globalSplitManager();
    if (!manager) return;
    const notification = latestNotification();
    openNotification(notification, manager, newSplit);
  };

  const openInCurrentSplit = () => {
    navigateToLatestNotification(false);
  };

  const openInNewSplit = () => {
    if (!canOpenInNewSplit()) return;
    navigateToLatestNotification(true);
  };

  const markAllAsDone = () => {
    void notificationSource.bulkMarkAsDone(props.group.notifications);
  };

  const markAllAsRead = () => {
    void notificationSource.bulkMarkAsRead(props.group.notifications);
  };

  const openFullscreen = () => {
    const { params } = getChannelNotificationParams(latestNotification());
    globalSplitManager()?.createPopoverSplit({
      content: {
        type: 'channel',
        id: props.group.entityId,
        params,
      },
    });
  };

  const isSlim = () => props.isSlim ?? false;

  const ButtonContent = () => (
    <NavRow
      class="transition-[opacity,transform] justify-start w-full h-7"
      draggable={false}
      classList={{
        'opacity-0 -translate-y-2': !isVisible(),
        'opacity-100 translate-y-0': isVisible(),
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        navigateToLatestNotification(e.shiftKey);
      }}
    >
      <div
        class={cn('relative flex items-center justify-center shrink-0 size-5')}
      >
        <Show
          when={isDM() && senderId()}
          fallback={
            <EntityIcon targetType="channel" size="xs" class="size-3.5" />
          }
        >
          <UserIcon
            id={senderId()!}
            size="sm"
            suppressClick
            showTooltip={false}
            class="size-3.5"
          />
        </Show>
        <Show when={isSlim()}>
          <div class="absolute -top-0.5 -right-0.5 size-1.5 bg-accent rounded-full ring-surface ring-2" />
        </Show>
      </div>

      <Show when={!isSlim()}>
        <span class="text-sm font-medium truncate">{displayName()}</span>

        <Show when={count() > 0}>
          <span class="shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center text-xs font-medium bg-ink/6 text-ink-muted rounded-md ml-auto">
            {count()}
          </span>
        </Show>
      </Show>
    </NavRow>
  );

  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [hoverCardOpen, setHoverCardOpen] = createSignal(false);

  createEffect(() => {
    props.onFloatingOpenChange?.(contextMenuOpen() || hoverCardOpen());
  });

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenu.Trigger
        class={cn(isSlim() ? 'flex justify-center' : 'w-full')}
      >
        <Show
          when={!isSlim()}
          fallback={
            <Tooltip label={displayName()} placement="right">
              <ButtonContent />
            </Tooltip>
          }
        >
          <UnreadHoverCard
            group={props.group}
            disabled={contextMenuOpen()}
            onOpenChange={setHoverCardOpen}
          >
            <ButtonContent />
          </UnreadHoverCard>
        </Show>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenuContent class="text-xs text-ink-muted">
          <MenuGroup>
            <MenuItem
              text="Open in new split"
              onClick={openInNewSplit}
              disabled={!canOpenInNewSplit()}
            />
            <MenuItem text="Open fullscreen" onClick={openFullscreen} />
            <MenuItem
              text="Open in current split"
              onClick={openInCurrentSplit}
            />
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuItem text="Mark all as read" onClick={markAllAsRead} />
            <MenuItem text="Mark all as done" onClick={markAllAsDone} />
          </MenuGroup>
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

function filterUnreadNotDone(notifications: UnifiedNotification[]) {
  return notifications.filter((n) => !n.viewed_at && !n.done);
}

function ChannelGroupDropdownItem(props: { group: ChannelGroup }) {
  const senderName = useSenderName(props.group.latestSenderId);
  const count = () => props.group.notifications.length;
  const displayName = () => {
    if (props.group.isDM) return senderName() ?? 'Direct Message';
    return props.group.channelName ?? 'Unknown Channel';
  };
  const latestNotification = () => props.group.notifications[0];

  return (
    <Dropdown.Item
      class="min-h-8 gap-2 px-2.5 text-[13px]"
      onSelect={() => {
        const manager = globalSplitManager();
        if (manager) openNotification(latestNotification(), manager, false);
      }}
    >
      <Show
        when={props.group.isDM && props.group.latestSenderId}
        fallback={
          <EntityIcon targetType="channel" size="xs" class="size-3.5" />
        }
      >
        <UserIcon
          id={props.group.latestSenderId!}
          size="md"
          suppressClick
          showTooltip={false}
        />
      </Show>
      <span class="min-w-0 flex-1 truncate text-ink">{displayName()}</span>
      <span class="shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center text-xs font-medium bg-ink/6 text-ink-muted rounded-md">
        {count()}
      </span>
    </Dropdown.Item>
  );
}

export const ChannelsUnreadWidget = (props: {
  sidebarState: SidebarState;
  onSectionOpenChange?: () => void;
  onDropdownOpenChange?: (open: boolean) => void;
}) => {
  const notificationSource = useGlobalNotificationSource();
  const allNotifications = () => [...notificationSource.notifications()];

  const filteredNotifications = () => filterUnreadNotDone(allNotifications());

  const channelGroupsMap = createMemo(() =>
    groupByChannel(filteredNotifications())
  );

  const [orderedIds, setOrderedIds] = createSignal<string[]>([]);

  createEffect(
    on(channelGroupsMap, (groups) => {
      const currentIds = new Set(groups.keys());
      const prev = orderedIds();
      const kept = prev.filter((id) => currentIds.has(id));
      const keptSet = new Set(kept);
      const added = [...currentIds].filter((id) => !keptSet.has(id));

      if (added.length === 0 && kept.length === prev.length) return;

      added.sort((a, b) => {
        const aTime = groups.get(a)?.notifications[0]?.created_at;
        const bTime = groups.get(b)?.notifications[0]?.created_at;
        return compareDateDesc(aTime, bTime);
      });

      setOrderedIds([...added, ...kept]);
    })
  );

  const channelGroups = createMemo(() => {
    const groups = channelGroupsMap();
    return orderedIds()
      .map((id) => groups.get(id))
      .filter((g): g is ChannelGroup => g != null);
  });

  const isSlim = () => props.sidebarState === 'slim';
  const SLIM_MAX = 4;
  const slimVisible = () => channelGroups().slice(0, SLIM_MAX);
  const slimOverflow = () => Math.max(0, channelGroups().length - SLIM_MAX);
  const sectionItems = createMemo<CollapsibleSidebarSectionItem[]>(() =>
    channelGroups().map((group) => ({
      id: group.entityId,
      visible: () => (
        <ChannelGroupItem
          group={group}
          animate={false}
          onFloatingOpenChange={props.onDropdownOpenChange}
        />
      ),
      dropdown: () => <ChannelGroupDropdownItem group={group} />,
    }))
  );

  return (
    <Show when={channelGroups().length > 0}>
      <Show
        when={!isSlim()}
        fallback={
          <section class="w-full py-1.5 flex flex-col items-start gap-0.5">
            <For each={slimVisible()}>
              {(group) => (
                <ChannelGroupItem group={group} animate={false} isSlim />
              )}
            </For>
            <Show when={slimOverflow() > 0}>
              <span class="w-full text-center text-xxs text-ink-muted mt-1">
                +{slimOverflow()}
              </span>
            </Show>
          </section>
        }
      >
        <CollapsibleSidebarSection
          label="Unread"
          items={sectionItems()}
          onOpenChange={() => props.onSectionOpenChange?.()}
        />
      </Show>
    </Show>
  );
};
