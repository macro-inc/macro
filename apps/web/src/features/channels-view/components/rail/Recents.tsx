import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { useUserId } from '@core/context/user';
import { Key } from '@solid-primitives/keyed';
import { Match, Switch } from 'solid-js';
import { channelMentionsUser } from '../../utils';
import { ChannelsEmptyState } from '../ChannelsEmptyState';
import { useChannelRail } from './Context';
import { ConversationCard } from './ConversationCard';
import { SlimChannelItem } from './Item';

export function ChannelsRailRecents() {
  const rail = useChannelRail();
  const currentUserId = useUserId();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  const hasItems = () =>
    !forceEmptyState() && rail.recentConversations().length > 0;

  return (
    <Switch>
      <Match when={rail.mode() === 'full' && !hasItems()}>
        <ChannelsEmptyState scope="recents" topAligned />
      </Match>
      <Match when={rail.mode() === 'full'}>
        <div class="flex w-full flex-col divide-y divide-edge-muted">
          <Key each={rail.recentConversations()} by={(channel) => channel.id}>
            {(channel) => (
              <ConversationCard
                id={rail.item.domId(channel().id)}
                channel={channel()}
                senderId={channel().latestRootMessage?.senderId}
                mentionedCurrentUser={channelMentionsUser(
                  channel(),
                  currentUserId()
                )}
                unread={rail.activity.isUnread(channel().id)}
                callStatus={rail.activity.callStatus(channel().id)}
                incomingCallId={rail.activity.incomingCallId(channel().id)}
                selected={rail.item.isSelected(channel().id)}
                focused={rail.item.isFocused(channel().id)}
                onActivate={() => rail.item.activate(channel().id)}
              />
            )}
          </Key>
        </div>
      </Match>
      <Match when={hasItems()}>
        <div class="flex w-full flex-col gap-0.5">
          <Key each={rail.recentConversations()} by={(channel) => channel.id}>
            {(channel) => (
              <SlimChannelItem
                id={rail.item.domId(channel().id)}
                channel={channel()}
                unread={rail.activity.isUnread(channel().id)}
                callStatus={rail.activity.callStatus(channel().id)}
                selected={rail.item.isSelected(channel().id)}
                focused={rail.item.isFocused(channel().id)}
                onActivate={() => rail.item.activate(channel().id)}
              />
            )}
          </Key>
        </div>
      </Match>
    </Switch>
  );
}
