import { favoriteIconType } from '@app/util/favorites';
import { ChannelIcon } from '@channel/channel-icon';
import { EntityIcon } from '@core/component/EntityIcon';
import type { UserIconSize } from '@core/component/UserIcon';
import { useChannelsContext } from '@core/context/channels';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { cn } from '@ui';
import { Show } from 'solid-js';

type FavoriteIconProps = {
  favorite: Favorite;
  avatarSize?: UserIconSize;
  class?: string;
};

function FavoriteChannelIcon(props: FavoriteIconProps & { channelId: string }) {
  const channels = useChannelsContext();
  const channel = () => channels.channelsById()[props.channelId];

  return (
    <span class={cn('inline-flex size-4 shrink-0', props.class)}>
      <ChannelIcon
        channelId={props.channelId}
        channelType={channel()?.channel_type ?? props.favorite.channelType}
        name={channel()?.name ?? undefined}
        avatarSize={props.avatarSize ?? 'sm'}
        suppressClick
        showTooltip={false}
      />
    </span>
  );
}

/** Favorites adapt their identity to the same channel/DM renderer as rows. */
export function FavoriteIcon(props: FavoriteIconProps) {
  const channelId = () => {
    if (props.favorite.entityType === 'channel') return props.favorite.entityId;
    if (props.favorite.entityType === 'channel_message')
      return props.favorite.channelId;
  };

  return (
    <Show
      when={channelId()}
      fallback={
        <EntityIcon
          size="xs"
          targetType={favoriteIconType(props.favorite)}
          class={props.class}
        />
      }
    >
      {(id) => <FavoriteChannelIcon {...props} channelId={id()} />}
    </Show>
  );
}
