import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import { entityHasUnreadNotifications } from '@notifications/notification-helpers';
import { notificationStateFromGraphql } from '@notifications/notification-state';
import { useEntityNotifications } from '@queries/notification/entity-notifications';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { SoupEntityInput } from '@service-storage/graphql/generated/graphql';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';

/** Favorite rows share the entity's existing notification read state. */
export function FavoriteUnreadIndicator(props: { favorite: Favorite }) {
  const source = useGlobalNotificationSource();
  const graphqlSoup = useFeatureFlag(enableGraphqlSoup);
  const notifications = useEntityNotifications(() => {
    if (!graphqlSoup().enabled) return;
    const entityType = match(props.favorite.entityType)
      .returnType<SoupEntityInput['entityType'] | undefined>()
      .with('document', () => 'DOCUMENT')
      .with('project', () => 'PROJECT')
      .with('foreign_entity', () => 'FOREIGN_ENTITY')
      .otherwise(() => undefined);
    return entityType && { entityType, entityId: props.favorite.entityId };
  });
  const unread = () => {
    if (graphqlSoup().loading) return false;
    if (!graphqlSoup().enabled) {
      return entityHasUnreadNotifications(source, {
        id: props.favorite.entityId,
        type: props.favorite.entityType,
      });
    }
    return notifications().some((notification) => {
      const state = notificationStateFromGraphql(notification.state);
      return (
        (source.withLocalState?.({ id: notification.id, state }) ?? state) ===
        'unseen'
      );
    });
  };

  return (
    <Show when={unread()}>
      <UnreadIndicator active class="ml-auto" />
    </Show>
  );
}
