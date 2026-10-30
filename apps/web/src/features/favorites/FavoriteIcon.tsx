import {
  favoriteIconType,
  useFavoriteDmRecipientId,
} from '@app/util/favorites';
import { ChannelAvatar } from '@channel/channel-avatar';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon, type UserIconSize } from '@core/component/UserIcon';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Show } from 'solid-js';

/**
 * Icon for a favorite. DM channel favorites show the other participant's
 * avatar, and other channels show their channel picture, matching channel
 * rows elsewhere in the sidebar. Other favorites keep their entity icon.
 *
 * The favorite's identity must be stable for the component's lifetime
 * (favorites lists key rows by entity, so it is).
 */
export function FavoriteIcon(props: {
  favorite: Favorite;
  avatarSize?: UserIconSize;
  class?: string;
}) {
  const dmRecipientId = useFavoriteDmRecipientId(props.favorite);
  return (
    <Show
      when={dmRecipientId()}
      fallback={
        <Show
          when={
            props.favorite.entityType === 'channel' &&
            props.favorite.channelType !== 'direct_message'
          }
          fallback={
            <EntityIcon
              size="xs"
              targetType={favoriteIconType(props.favorite)}
              class={props.class}
            />
          }
        >
          <ChannelAvatar
            channelId={props.favorite.entityId}
            class={`size-4 ${props.class ?? ''}`}
            fallback={
              <EntityIcon
                size="xs"
                targetType={favoriteIconType(props.favorite)}
                class={props.class}
              />
            }
          />
        </Show>
      }
    >
      {(recipientId) => (
        <UserIcon
          id={recipientId()}
          size={props.avatarSize ?? 'sm'}
          suppressClick
          showTooltip={false}
          class={props.class}
        />
      )}
    </Show>
  );
}
