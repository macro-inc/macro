import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import { useEntityHasUnreadNotifications } from '@notifications/notification-helpers';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Show } from 'solid-js';

/** Favorite rows share the entity's existing notification read state. */
export function FavoriteUnreadIndicator(props: { favorite: Favorite }) {
  const unread = useEntityHasUnreadNotifications(
    useGlobalNotificationSource(),
    {
      id: props.favorite.entityId,
      type: props.favorite.entityType,
    }
  );

  return (
    <Show when={unread()}>
      <UnreadIndicator active class="ml-auto" />
    </Show>
  );
}
