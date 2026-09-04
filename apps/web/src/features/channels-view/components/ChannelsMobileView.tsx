import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useUserId } from '@core/context/user';
import { compareDateDesc } from '@core/util/date';
import type { ChannelEntity } from '@entity';
import { Key } from '@solid-primitives/keyed';
import { createMemo, createSignal, createUniqueId, Show } from 'solid-js';
import { useChannelsView } from '../channels-view-context';
import { ConversationCard } from './rail/ChannelRailItems';
import { useChannelCallState } from './rail/useChannelCallState';
import { useChannelRailActivity } from './rail/useChannelRailActivity';

type MobileChannelsTab = 'channels' | 'dms' | 'recents';

const MOBILE_CHANNEL_TABS: readonly PillTabItem<MobileChannelsTab>[] = [
  { value: 'recents', label: 'Recents' },
  { value: 'channels', label: 'Channels' },
  { value: 'dms', label: 'DMs' },
];
const MOBILE_TAB_STRIP_CLASS =
  '-ml-(--mobile-chrome-gutter) w-[100cqw] max-w-none flex-none';
const MOBILE_TAB_CONTENT_CLASS = 'px-(--mobile-chrome-gutter)';

export function ChannelsMobileView(props: { channels: ChannelEntity[] }) {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const currentUserId = useUserId();
  const { state, setSelectedChannelId, setTab } = useChannelsView();
  const [mobileTab, setMobileTab] = createSignal<MobileChannelsTab>(
    state.tab === 'recents' ? 'recents' : 'channels'
  );
  const listId = createUniqueId();
  const { callActivity, incomingCallIds, callStatuses } = useChannelCallState();
  const channelActivity = useChannelRailActivity(
    () => props.channels,
    callActivity
  );

  const visibleChannels = createMemo(() => {
    if (mobileTab() === 'channels') {
      return props.channels.filter(
        (channel) => channel.channelType !== 'direct_message'
      );
    }
    if (mobileTab() === 'dms') {
      return props.channels.filter(
        (channel) => channel.channelType === 'direct_message'
      );
    }

    return props.channels
      .filter((channel) => channel.latestRootMessage)
      .sort((a, b) =>
        compareDateDesc(
          a.latestRootMessage?.createdAt,
          b.latestRootMessage?.createdAt
        )
      );
  });

  const selectTab = (tab: MobileChannelsTab) => {
    setMobileTab(tab);
    setTab(tab === 'recents' ? 'recents' : 'browse');
  };

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
    if (mobileTab() === 'channels') return 'No channels';
    if (mobileTab() === 'dms') return 'No direct messages';
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
            value={mobileTab()}
            onChange={selectTab}
          />
        </div>
      </SplitHeaderLeft>

      <div
        role="tree"
        aria-label={`${MOBILE_CHANNEL_TABS.find((tab) => tab.value === mobileTab())?.label ?? 'Channels'} conversations`}
        class="scrollbar-hidden size-full min-h-0 overflow-y-auto pt-(--mobile-content-inset-top) pb-[max(1rem,var(--mobile-content-inset-bottom,0px))]"
      >
        <div aria-hidden="true" class="h-3" />
        <Show
          when={visibleChannels().length > 0}
          fallback={
            <div class="grid min-h-32 place-items-center px-(--mobile-chrome-gutter) text-sm text-ink-muted">
              {emptyLabel()}
            </div>
          }
        >
          <div class="flex flex-col divide-y divide-edge-muted/50">
            <Key each={visibleChannels()} by={(channel) => channel.id}>
              {(channel) => (
                <ConversationCard
                  id={`${listId}-channel:${channel().id}`}
                  class="px-(--mobile-chrome-gutter) touch:pl-6"
                  channel={channel()}
                  showLatestMessage={mobileTab() === 'recents'}
                  senderId={channel().latestRootMessage?.senderId}
                  mentionedCurrentUser={mentionsCurrentUser(channel())}
                  unread={channelActivity.unreadChannelIds().has(channel().id)}
                  callStatus={callStatuses().get(channel().id)}
                  incomingCallId={incomingCallIds().get(channel().id)}
                  selected={state.selectedChannelId === channel().id}
                  focused={false}
                  onActivate={() => openChannel(channel())}
                />
              )}
            </Key>
          </div>
        </Show>
      </div>
    </>
  );
}
