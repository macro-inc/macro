import { favoriteIconType, useFavoriteAppearance } from '@app/util/favorites';
import { ChannelIcon } from '@channel/channel-icon';
import { EntityIcon } from '@core/component/EntityIcon';
import type { UserIconSize } from '@core/component/UserIcon';
import { useChannel } from '@core/context/channels';
import type { ChannelType } from '@service-storage/generated/schemas/channelType';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';

type FavoriteIconProps = {
  favorite: Favorite;
  avatarSize?: UserIconSize;
  class?: string;
};

/** The favorite's saved channel type, when it is one the icon knows. */
function savedChannelType(
  value: string | null | undefined
): ChannelType | undefined {
  return match(value)
    .with('public', 'private', 'team', 'direct_message', (type) => type)
    .otherwise(() => undefined);
}

function FavoriteChannelIcon(props: FavoriteIconProps & { channelId: string }) {
  const channel = useChannel(() => props.channelId);

  return (
    <span class={cn('inline-flex size-4 shrink-0', props.class)}>
      <ChannelIcon
        channelId={props.channelId}
        channelType={
          channel()?.channelType ?? savedChannelType(props.favorite.channelType)
        }
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
  const appearance = useFavoriteAppearance(props.favorite);
  return (
    <Show
      when={channelId()}
      fallback={
        <EntityIcon
          size="xs"
          targetType={favoriteIconType(props.favorite)}
          appearance={appearance()}
          class={props.class}
        />
      }
    >
      {(id) => <FavoriteChannelIcon {...props} channelId={id()} />}
    </Show>
  );
}
