import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useUserId } from '@core/context/user';
import type { ChannelEntity } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import type { SoupAstItemsQuery } from '@queries/soup/items';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  createMemo,
  createSignal,
  createUniqueId,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Button } from '@ui';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { useChannelsView } from '../channels-view-context';
import { ConversationCard } from './rail/ChannelRailItems';
import { useChannelCallState } from './rail/useChannelCallState';
import { useChannelRailActivity } from './rail/useChannelRailActivity';

export type MobileChannelsTab = 'channels' | 'dms' | 'recents';

const MOBILE_CHANNEL_TABS: readonly PillTabItem<MobileChannelsTab>[] = [
  { value: 'recents', label: 'Recents' },
  { value: 'channels', label: 'Channels' },
  { value: 'dms', label: 'DMs' },
];
const MOBILE_TAB_STRIP_CLASS =
  '-ml-(--mobile-chrome-gutter) w-[100cqw] max-w-none flex-none';
const MOBILE_TAB_CONTENT_CLASS = 'px-(--mobile-chrome-gutter)';
const MOBILE_CHANNEL_ITEM_SIZE = 72;
const MOBILE_CHANNEL_BUFFER_SIZE = MOBILE_CHANNEL_ITEM_SIZE * 6;
const LOAD_MORE_THRESHOLD = 300;

export function ChannelsMobileView(props: {
  channels: ChannelEntity[];
  source: SoupAstItemsQuery;
  tab: MobileChannelsTab;
  onTabChange: (tab: MobileChannelsTab) => void;
}) {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const currentUserId = useUserId();
  const { state, setSelectedChannelId, setTab } = useChannelsView();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const [topSpacer, setTopSpacer] = createSignal<HTMLDivElement>();
  const topSpacerSize = createElementSize(topSpacer);
  const listId = createUniqueId();
  const { callActivity, incomingCallIds, callStatuses } = useChannelCallState();
  const channelActivity = useChannelRailActivity(
    () => props.channels,
    callActivity
  );

  const visibleChannels = createMemo(() => {
    if (props.tab === 'channels') {
      return props.channels.filter(
        (channel) => channel.channelType !== 'direct_message'
      );
    }

    if (props.tab === 'dms') {
      return props.channels.filter(
        (channel) => channel.channelType === 'direct_message'
      );
    }

    return props.channels.filter((channel) => channel.latestRootMessage);
  });

  const selectTab = (tab: MobileChannelsTab) => {
    props.onTabChange(tab);
    setTab(tab === 'recents' ? 'recents' : 'browse');
    viewport()?.scrollTo({ top: 0 });
  };

  const topInset = () => topSpacerSize.height ?? 0;

  function loadNextPage() {
    if (
      props.source.isFetching ||
      props.source.isFetchingNextPage ||
      !props.source.hasNextPage
    ) {
      return;
    }

    void props.source.fetchNextPage();
  }

  function checkNearEnd(offset?: number) {
    const handle = virtualizer();
    if (!handle) return;

    const distance =
      handle.scrollSize - handle.viewportSize - (offset ?? handle.scrollOffset);
    if (distance >= LOAD_MORE_THRESHOLD) return;

    loadNextPage();
  }

  const mentionsCurrentUser = (channel: ChannelEntity) => {
    const userId = currentUserId()?.toLocaleLowerCase();

    return Boolean(
      userId &&
        channel.latestRootMessage?.mentions.some(
          (mention) => mention.toLocaleLowerCase() === userId
        )
    );
  };

  const openChannel = (channel: ChannelEntity) => {
    setSelectedChannelId(channel.id);
    void openEntityInSplitFromUnifiedList(channel, {
      splitHandle: panel.handle,
      referredFrom: 'channels',
      notificationSource,
    });
  };

  const emptyLabel = () => {
    if (props.tab === 'channels') return 'No channels';
    if (props.tab === 'dms') return 'No direct messages';

    return 'No recent conversations';
  };

  return (
    <>
      <SplitHeaderLeft>
        <div class="flex h-full w-full min-w-0 flex-1 items-center">
          <PillTabs
            scrollable
            class={MOBILE_TAB_STRIP_CLASS}
            contentClass={MOBILE_TAB_CONTENT_CLASS}
            items={MOBILE_CHANNEL_TABS}
            value={props.tab}
            onChange={selectTab}
          />
        </div>
      </SplitHeaderLeft>

      <div
        role="tree"
        aria-label={`${MOBILE_CHANNEL_TABS.find((tab) => tab.value === props.tab)?.label ?? 'Channels'} conversations`}
        aria-busy={props.source.isFetchingNextPage}
        class="size-full min-h-0 overflow-hidden"
      >
        <div
          ref={setViewport}
          class="scrollbar-hidden size-full min-h-0 overflow-y-auto overscroll-none"
        >
          <div
            ref={setTopSpacer}
            aria-hidden="true"
            class="h-[calc(var(--mobile-content-inset-top,0px)+0.75rem)]"
          />
          <Switch>
            <Match when={props.source.isLoading}>
              <div class="grid min-h-32 place-items-center text-ink-muted">
                <SpinnerIcon
                  aria-label="Loading conversations"
                  class="size-5 animate-spin"
                />
              </div>
            </Match>
            <Match when={props.source.error}>
              <div class="flex min-h-32 flex-col items-center justify-center gap-3 px-(--mobile-chrome-gutter) text-sm text-ink-muted">
                <span>Conversations couldn’t be loaded.</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void props.source.refresh()}
                >
                  Try again
                </Button>
              </div>
            </Match>
            <Match when={visibleChannels().length === 0}>
              <div class="flex min-h-32 flex-col items-center justify-center gap-3 px-(--mobile-chrome-gutter) text-sm text-ink-muted">
                <span>{emptyLabel()}</span>
                <Show when={props.source.hasNextPage}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={props.source.isFetchingNextPage}
                    onClick={loadNextPage}
                  >
                    <Show
                      when={props.source.isFetchingNextPage}
                      fallback="Search more"
                    >
                      <SpinnerIcon class="size-3 animate-spin" />
                      Searching
                    </Show>
                  </Button>
                </Show>
              </div>
            </Match>
            <Match when={true}>
              <Virtualizer
                ref={(handle) => setVirtualizer(handle)}
                data={visibleChannels()}
                scrollRef={viewport()}
                startMargin={topInset()}
                itemSize={MOBILE_CHANNEL_ITEM_SIZE}
                bufferSize={MOBILE_CHANNEL_BUFFER_SIZE}
                onScroll={checkNearEnd}
              >
                {(channel) => (
                  <ConversationCard
                    id={`${listId}-channel:${channel.id}`}
                    class="border-b border-edge-muted/50 px-(--mobile-chrome-gutter) touch:pl-6"
                    channel={channel}
                    showLatestMessage={props.tab === 'recents'}
                    senderId={channel.latestRootMessage?.senderId}
                    mentionedCurrentUser={mentionsCurrentUser(channel)}
                    unread={channelActivity.unreadChannelIds().has(channel.id)}
                    callStatus={callStatuses().get(channel.id)}
                    incomingCallId={incomingCallIds().get(channel.id)}
                    selected={state.selectedChannelId === channel.id}
                    focused={false}
                    onActivate={() => openChannel(channel)}
                  />
                )}
              </Virtualizer>
              <Show when={props.source.isFetchingNextPage}>
                <div class="flex h-12 items-center justify-center text-ink-muted">
                  <SpinnerIcon
                    aria-label="Loading more conversations"
                    class="size-4 animate-spin"
                  />
                </div>
              </Show>
            </Match>
          </Switch>
          <div
            aria-hidden="true"
            class="h-[max(1rem,var(--mobile-content-inset-bottom,0px))]"
          />
        </div>
      </div>
    </>
  );
}
