import { Key } from '@solid-primitives/keyed';
import { Match, Switch } from 'solid-js';
import { ChannelsEmptyState } from '../ChannelsEmptyState';
import { useChannelRail } from './Context';
import { SlimChannelItem } from './Item';
import { ConversationCard } from './ConversationCard';

export function ChannelsRailRecents() {
  const rail = useChannelRail();

  const hasItems = () =>
    !rail.forceEmptyState() && rail.recentConversations().length > 0;

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
                mentionedCurrentUser={rail.mentionsCurrentUser(channel())}
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
