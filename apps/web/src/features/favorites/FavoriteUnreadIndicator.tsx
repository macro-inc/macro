import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import { useEntityHasUnreadNotifications } from '@notifications/notification-helpers';
import {
  hasFavoriteUnreadWitness,
  useFavoriteUnreadPresence,
} from '@queries/favorites/unread';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Show } from 'solid-js';

/** Favorite rows share the entity's existing notification read state. */
export function FavoriteUnreadIndicator(props: { favorite: Favorite }) {
  const source = useGlobalNotificationSource();
  const legacyUnread = useEntityHasUnreadNotifications(source, {
    id: props.favorite.entityId,
    type: props.favorite.entityType,
  });
  // Keep Chat on its existing notification path.
  const witnesses =
    isFeatureEnabled(enableGraphqlSoup) && props.favorite.entityType !== 'chat'
      ? useFavoriteUnreadPresence()
      : () => [];
  const unread = () => {
    if (
      !isFeatureEnabled(enableGraphqlSoup) ||
      props.favorite.entityType === 'chat'
    )
      return legacyUnread();
    return hasFavoriteUnreadWitness(witnesses(), props.favorite, source);
  };

  return (
    <Show when={unread()}>
      <UnreadIndicator active class="ml-auto" />
    </Show>
  );
}
