import { createListController } from '@app/components/list';
import { toEntityActionListState } from '@app/features/next-soup/actions';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { SoupEntityContextMenu } from '@app/features/soup';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { CHANNEL_ACTION_VIEW_CONTEXT } from '@channel/Channel/channel-actions';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { PullToRefresh } from '@components/app/mobile/PullToRefresh';
import { holdRowPress } from '@components/app/mobile/rowPress';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import type { ChannelEntity } from '@entity';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import XIcon from '@icon/system/regular/x.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, EmptyStatePanel } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { sortChannels } from '../core/channel-sort';
import type { ChannelsDataSource } from '../queries';
import type { ChannelSectionPreferences } from '../types';
import { ChannelFeedRow } from './ChannelFeedRow';
import { ChannelPin, ChannelPinGrid } from './ChannelPins';
import { ChannelsEmptyState } from './ChannelsEmptyState';
import { ChannelLiveCallBadge } from './rail/ChannelLiveCallBadge';
import { IncomingCallActions } from './rail/ChannelRailItems';
import { useChannelCalls } from './rail/hooks/useChannelCalls';
import { useChannelRailActivity } from './rail/hooks/useChannelRailActivity';

const MOBILE_CHANNEL_ROW_HEIGHT = 72;
const MOBILE_CHANNEL_BUFFER_SIZE = MOBILE_CHANNEL_ROW_HEIGHT * 6;
const LOAD_MORE_THRESHOLD = 300;

export function ChannelsMobileView(props: {
  source: ChannelsDataSource;
  /** Favorited conversations pinned above the list in display order. */
  pinned: readonly ChannelEntity[];
  searchQuery: string;
  onClearSearch: () => void;
  /** Admit a conversation into the host's inline preview when available. */
  openPreview?: (channel: ChannelEntity) => boolean;
  horizontalPins?: boolean;
  preferences?: ChannelSectionPreferences;
  scrollKey?: string;
  includePinnedInList?: boolean;
  /** Controls between the favorites and the list, included in its measured offset. */
  children?: JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const [listHeader, setListHeader] = createSignal<HTMLDivElement>();
  const listHeaderSize = createElementSize(listHeader);
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );
  const channelCalls = useChannelCalls();
  const pinned = () => (props.searchQuery.trim() ? [] : props.pinned);
  const pinnedIds = createMemo(
    () => new Set(pinned().map((channel) => channel.id))
  );
  const activityChannels = createMemo(() => [
    ...pinned(),
    ...props.source.items().filter((channel) => !pinnedIds().has(channel.id)),
  ]);
  const channelActivity = useChannelRailActivity(
    activityChannels,
    channelCalls
  );
  // Pinned conversations leave the list below, as in iMessage, except while
  // a call rings: its Join and Decline actions live on the list row.
  const visibleChannels = createMemo(() => {
    const channels = props.source
      .items()
      .filter(
        (channel) =>
          (props.includePinnedInList ||
            !pinnedIds().has(channel.id) ||
            channelActivity.incomingCallIds().has(channel.id)) &&
          (!props.preferences?.unreadOnly ||
            channelActivity.unreadChannelIds().has(channel.id))
      );
    const sort = props.preferences?.sort;
    if (!sort || sort === 'manual') return channels;
    if (sort === 'name')
      return channels.sort((left, right) =>
        left.name.localeCompare(right.name)
      );
    return sortChannels(channels, sort);
  });
  const isUnread = (channel: ChannelEntity) =>
    channelActivity.unreadChannelIds().has(channel.id);
  const actionController = createListController({
    items: activityChannels,
    getKey: (channel) => channel.id,
    isSelectable: () => false,
  });
  const actionList = toEntityActionListState({
    controller: actionController,
    getEntity: (channel) => channel,
  });

  createEffect(
    on(
      () => [props.searchQuery, props.scrollKey],
      () => viewport()?.scrollTo({ top: 0 })
    )
  );

  const topInset = () => listHeaderSize.height ?? 0;

  function loadNextPage() {
    if (
      props.source.isFetching() ||
      props.source.isLoadingMore() ||
      !props.source.hasMore()
    ) {
      return;
    }

    fireAndForget(props.source.loadMore(), 'channels-view');
  }

  function checkNearEnd(offset?: number) {
    const handle = virtualizer();
    if (!handle) return;

    const distance =
      handle.scrollSize - handle.viewportSize - (offset ?? handle.scrollOffset);
    if (distance >= LOAD_MORE_THRESHOLD) return;

    loadNextPage();
  }

  let opening = 0;
  onCleanup(() => {
    opening += 1;
  });
  const openChannel = async (channel: ChannelEntity, event: MouseEvent) => {
    const request = ++opening;
    const releaseRowPress = holdRowPress(event);
    try {
      if (!event.shiftKey && props.openPreview?.(channel)) return;
      await openEntityInSplitFromUnifiedList(channel, {
        ...(event.shiftKey && props.openPreview
          ? { openInNewSplit: true }
          : {}),
        splitHandle: panel.handle,
        referredFrom: 'channels',
        notificationSource,
        channelNavigation: 'latest',
        channelReadScope: 'top-level',
      });
    } catch (error) {
      if (request !== opening) return;
      console.error('Failed to open conversation', error);
      toast.failure('Unable to open conversation. Please try again.');
    } finally {
      releaseRowPress?.();
    }
  };

  const callActions = (channelId: string) => {
    const ringing = channelActivity.incomingCallIds().get(channelId);
    const live = channelActivity.callStatuses().has(channelId);
    if (!ringing && !live) return undefined;
    return (
      <Show
        when={ringing}
        fallback={<ChannelLiveCallBadge channelId={channelId} />}
      >
        {(id) => <IncomingCallActions callId={id()} channelId={channelId} />}
      </Show>
    );
  };
  const content = (
    <Switch>
      <Match
        when={
          !forceEmptyState() &&
          props.source.isLoading() &&
          visibleChannels().length === 0
        }
      >
        <div class="grid min-h-32 place-items-center text-ink-muted">
          <SpinnerIcon
            aria-hidden={false}
            aria-label="Loading conversations"
            class="size-5 animate-spin"
          />
        </div>
      </Match>
      <Match
        when={
          !forceEmptyState() &&
          props.source.error() &&
          visibleChannels().length === 0
        }
      >
        <div class="flex min-h-32 flex-col items-center justify-center gap-3 px-(--mobile-chrome-gutter) text-sm text-ink-muted">
          <span>Conversations couldn’t be loaded.</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              fireAndForget(props.source.refresh(), 'channels-view')
            }
          >
            Try again
          </Button>
        </div>
      </Match>
      <Match
        when={
          forceEmptyState() ||
          (visibleChannels().length === 0 && pinned().length === 0)
        }
      >
        <Show
          when={props.searchQuery.trim()}
          fallback={<ChannelsEmptyState scope="recents" />}
        >
          {(query) => (
            <EmptyStatePanel
              centered
              graphic={EmptyStateNoSearchMatchGraphic}
              title="No results"
              description={
                <span>
                  No conversations match{' '}
                  <span class="[overflow-wrap:anywhere]">“{query()}”</span>
                </span>
              }
              primaryAction={{
                label: 'Clear search',
                icon: XIcon,
                onClick: props.onClearSearch,
              }}
              class="h-auto touch:pt-0 touch:pb-(--mobile-content-inset-bottom)"
            />
          )}
        </Show>
      </Match>
      <Match when={true}>
        <Virtualizer
          ref={(handle) => setVirtualizer(handle)}
          data={visibleChannels()}
          scrollRef={viewport()}
          startMargin={topInset()}
          itemSize={MOBILE_CHANNEL_ROW_HEIGHT}
          bufferSize={MOBILE_CHANNEL_BUFFER_SIZE}
          onScroll={checkNearEnd}
        >
          {(channel, index) => (
            <SoupEntityContextMenu
              entity={channel}
              list={actionList}
              selectedEntities={() => []}
              viewContext={CHANNEL_ACTION_VIEW_CONTEXT}
              class="block w-full"
              onOpenChange={(open) => {
                if (!open) return;
                actionController.focus.set(channel.id, {
                  reason: 'pointer',
                  force: true,
                });
              }}
            >
              <ChannelFeedRow
                channel={channel}
                unread={isUnread(channel)}
                mentions={channelActivity.mentionCount(channel.id)}
                ringing={channelActivity.incomingCallIds().has(channel.id)}
                trailing={callActions(channel.id)}
                divider={index() < visibleChannels().length - 1}
                onOpen={(event) =>
                  fireAndForget(openChannel(channel, event), 'channels-view')
                }
              />
            </SoupEntityContextMenu>
          )}
        </Virtualizer>
        <Show when={props.source.isLoadingMore()}>
          <div class="flex h-12 items-center justify-center text-ink-muted">
            <SpinnerIcon
              aria-hidden={false}
              aria-label="Loading more conversations"
              class="size-4 animate-spin"
            />
          </div>
        </Show>
        <Show
          when={
            props.source.error() &&
            !props.source.isLoadingMore() &&
            visibleChannels().length > 0
          }
        >
          <div class="flex items-center justify-center gap-2 py-3 text-xs text-ink-muted">
            <span>Couldn’t load more conversations.</span>
            <Button
              variant="secondary"
              size="xs"
              onClick={() =>
                fireAndForget(props.source.refresh(), 'channels-view')
              }
            >
              Try again
            </Button>
          </div>
        </Show>
      </Match>
    </Switch>
  );

  return (
    <div
      role="tree"
      aria-label="Recent conversations"
      aria-busy={props.source.isLoadingMore()}
      class="relative size-full min-h-0 overflow-hidden"
    >
      <PullToRefresh
        scrollContainer={viewport}
        onRefresh={props.source.refresh}
      />
      <div
        ref={setViewport}
        class="scrollbar-hidden size-full min-h-0 overflow-y-auto overscroll-none"
      >
        <div ref={setListHeader}>
          <div aria-hidden="true" class="h-(--mobile-content-inset-top)" />
          <Show when={pinned().length > 0}>
            <ChannelPinGrid horizontal={props.horizontalPins}>
              <For each={pinned()}>
                {(channel) => (
                  <SoupEntityContextMenu
                    entity={channel}
                    list={actionList}
                    selectedEntities={() => []}
                    viewContext={CHANNEL_ACTION_VIEW_CONTEXT}
                    class={
                      props.horizontalPins
                        ? 'block w-28 shrink-0'
                        : 'block w-1/3 min-w-0'
                    }
                    onOpenChange={(open) => {
                      if (!open) return;
                      actionController.focus.set(channel.id, {
                        reason: 'pointer',
                        force: true,
                      });
                    }}
                  >
                    <ChannelPin
                      channel={channel}
                      unread={isUnread(channel)}
                      mentions={channelActivity.mentionCount(channel.id)}
                      onActivate={(event) =>
                        fireAndForget(
                          openChannel(channel, event),
                          'channels-view'
                        )
                      }
                    />
                  </SoupEntityContextMenu>
                )}
              </For>
            </ChannelPinGrid>
          </Show>
          {props.children}
        </div>
        {content}
        <div
          aria-hidden="true"
          class="h-[max(1rem,var(--mobile-content-inset-bottom,0px))]"
        />
      </div>
    </div>
  );
}
