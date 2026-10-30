import { ViewSidebar } from '@app/components/view-shell';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createScrollTopFade } from '@core/util/createScrollTopFade';
import type { ChannelEntity } from '@entity';
import ChatsCircleIcon from '@icon/system/regular/chats-circle.svg';
import { cn } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { Virtualizer } from 'virtua/solid';
import { channelMentionsUser } from '../../../utils';
import { ChannelsEmptyState } from '../../ChannelsEmptyState';
import { ConversationsCreateMenu } from '../../ConversationsCreateMenu';
import { ChannelOption } from '../ChannelOption';
import {
  ChannelRailItemContextMenu,
  CONVERSATION_CARD_HEIGHT,
  ConversationCard,
  isPrimaryMouseDown,
} from '../ChannelRailItems';
import {
  ALL_THREADS_ROW_ID,
  domIdForRow,
  rowKeyForChannel,
  useChannelsRail,
} from '../ChannelsRailContext';
import {
  CollapsibleSection,
  RailListError,
  RailListLoading,
  RailListLoadingMore,
} from '../ChannelsRailSection';
import {
  useChannelRailItemState,
  useChannelRailScopeState,
  useChannelRailVirtualizer,
} from '../hooks/useChannelRailState';
import { ChannelLabelMenuItems } from './ChannelLabelRows';
import { ChannelSortDropdown } from './ChannelSortDropdown';

export function RecentConversationCard(props: { channel: ChannelEntity }) {
  const rail = useChannelsRail();
  const currentUserId = useUserId();
  const item = useChannelRailItemState(() => props.channel.id);

  return (
    <ChannelRailItemContextMenu
      channel={props.channel}
      class="block w-full"
      extraItems={<ChannelLabelMenuItems channel={props.channel} />}
    >
      <ConversationCard
        id={item().domId}
        class="border-b border-edge-muted"
        channel={props.channel}
        senderId={props.channel.latestRootMessage?.senderId}
        mentionedCurrentUser={channelMentionsUser(
          props.channel,
          currentUserId()
        )}
        unread={item().unread}
        muted={item().muted}
        callStatus={item().callStatus}
        incomingCallId={item().incomingCallId}
        selected={item().selected}
        focused={item().focused}
        onActivate={(event) =>
          rail.activateRow(rowKeyForChannel(props.channel.id), event)
        }
        onPress={(event) =>
          rail.prefetchRow(rowKeyForChannel(props.channel.id), event)
        }
      />
    </ChannelRailItemContextMenu>
  );
}

export function ExpandedRecents() {
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  createScrollTopFade(scrollRoot);
  const scope = useChannelRailScopeState(() => 'recents');
  const pagination = useChannelRailVirtualizer(() => 'recents');
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  return (
    <Switch>
      <Match
        when={
          !forceEmptyState() &&
          scope().source.isLoading() &&
          scope().items.length === 0
        }
      >
        <RailListLoading />
      </Match>
      <Match
        when={
          !forceEmptyState() &&
          scope().source.error() &&
          scope().items.length === 0
        }
      >
        <RailListError retry={scope().source.refresh} />
      </Match>
      <Match when={forceEmptyState() || scope().items.length === 0}>
        <ChannelsEmptyState scope="recents" topAligned />
      </Match>
      <Match when={true}>
        <div
          ref={setScrollRoot}
          class="scrollbar-hidden size-full min-h-0 overflow-y-auto"
          aria-busy={scope().source.isLoadingMore()}
        >
          <Virtualizer
            ref={pagination.registerVirtualizer}
            data={scope().items}
            scrollRef={scrollRoot()}
            itemSize={CONVERSATION_CARD_HEIGHT}
            bufferSize={360}
            keepMounted={scope().keepMounted}
            onScroll={pagination.loadMoreNearEnd}
          >
            {(channel) => <RecentConversationCard channel={channel} />}
          </Virtualizer>
          <Show when={scope().source.isLoadingMore()}>
            <RailListLoadingMore variant="recent" />
          </Show>
          <Show
            when={scope().source.error() && !scope().source.isLoadingMore()}
          >
            <RailListError retry={scope().source.refresh} compact />
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

export function ExpandedThreads() {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const scope = useChannelRailScopeState(() => 'threads');
  const pagination = useChannelRailVirtualizer(() => 'threads');
  const allThreadsDomId = () => domIdForRow(rail.railId, ALL_THREADS_ROW_ID);
  const allThreadsSelected = () => rail.threadsChannelId() === undefined;
  const allThreadsFocused = () => rail.list.focus.key() === ALL_THREADS_ROW_ID;
  const registerScrollRef = (element: HTMLDivElement) => {
    setScrollRoot(element);
    rail.registerScrollRef('threads', element);
  };

  return (
    <ViewSidebar.Content class="h-full overflow-hidden">
      <ViewSidebar.Nav aria-label="Thread filters" class="shrink-0">
        <ViewSidebar.Item
          as="div"
          id={allThreadsDomId()}
          role="treeitem"
          tabIndex={-1}
          class={cn(
            !allThreadsSelected() && allThreadsFocused() && 'bg-hover text-ink'
          )}
          active={allThreadsSelected()}
          aria-current={allThreadsSelected() ? 'page' : undefined}
          onClick={(event) => {
            if (!isPrimaryMouseDown(event)) return;
            rail.activateRow(ALL_THREADS_ROW_ID, event);
          }}
        >
          <ViewSidebar.Icon>
            <ChatsCircleIcon class="size-4" />
          </ViewSidebar.Icon>
          <span class="min-w-0 flex-1 truncate">All threads</span>
        </ViewSidebar.Item>
      </ViewSidebar.Nav>
      <CollapsibleSection.Root open sizing="fill">
        <CollapsibleSection.Header focused={false} focusWithin={false}>
          <span class="flex h-full min-w-0 flex-1 items-center px-2">
            <span class="min-w-0 truncate">Conversations</span>
          </span>
          <div data-section-action="" class="flex items-center gap-0.5">
            <ChannelSortDropdown group="threads" label="Conversations" />
            <Show when={isTouchDevice()}>
              <ConversationsCreateMenu />
            </Show>
          </div>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content
          open
          contentRef={registerScrollRef}
          class="flex min-h-0 flex-col gap-0.5"
        >
          <Switch>
            <Match
              when={scope().source.isLoading() && scope().items.length === 0}
            >
              <RailListLoading />
            </Match>
            <Match when={scope().source.error() && scope().items.length === 0}>
              <RailListError retry={scope().source.refresh} />
            </Match>
            <Match when={scope().items.length > 0}>
              <Virtualizer
                ref={pagination.registerVirtualizer}
                data={scope().items}
                scrollRef={scrollRoot()}
                itemSize={34}
                bufferSize={240}
                keepMounted={scope().keepMounted}
                onScroll={pagination.loadMoreNearEnd}
              >
                {(channel) => (
                  <div class="pb-0.5">
                    <ChannelOption channel={channel} />
                  </div>
                )}
              </Virtualizer>
              <Show when={scope().source.isLoadingMore()}>
                <RailListLoadingMore variant="channel" />
              </Show>
              <Show
                when={scope().source.error() && !scope().source.isLoadingMore()}
              >
                <RailListError retry={scope().source.refresh} compact />
              </Show>
            </Match>
            <Match when={true}>
              <div class="px-2 py-2 text-xs text-ink-extra-muted">
                No conversations
              </div>
            </Match>
          </Switch>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </ViewSidebar.Content>
  );
}
