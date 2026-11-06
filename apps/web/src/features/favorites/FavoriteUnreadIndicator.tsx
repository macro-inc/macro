import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { getEntityNotifications } from '@app/features/soup/entity-notifications';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { useIsAuthenticated } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import {
  createEffectOnEntityTypeNotification,
  entityHasUnreadNotifications,
  notificationIsRead,
} from '@notifications/notification-helpers';
import { queryReadyGate } from '@queries/gate';
import type { SoupEntityRef } from '@queries/soup/graphql/entity-input';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { createMemo, Show } from 'solid-js';
import { match } from 'ts-pattern';

/** Favorite rows share the entity's existing notification read state. */
export function FavoriteUnreadIndicator(props: { favorite: Favorite }) {
  const source = useGlobalNotificationSource();
  const graphqlSoup = useFeatureFlag(enableGraphqlSoup);
  const authenticated = useIsAuthenticated();
  const fields = createMemo(() => {
    const { entityId, entityType } = props.favorite;
    return match(entityType)
      .with('document', () => ({ documentId: [entityId] }))
      .with('project', () => ({ folderId: [entityId] }))
      .with('foreign_entity', () => ({ foreignEntityRecordId: [entityId] }))
      .otherwise(() => undefined);
  });
  const entityQuery = useSoupAstItemsQuery(
    () => {
      const body = compileToAst(
        queryStateFrom(defineQueryFilters({ include: fields() }))
      );
      // folderId selects children; a favorite targets the folder itself.
      if (props.favorite.entityType === 'project') {
        body.pf = { l: { pids: props.favorite.entityId } };
      }
      return { params: { limit: 1, sort_method: 'updated_at' }, body };
    },
    () => ({
      enabled:
        !graphqlSoup().loading &&
        graphqlSoup().enabled &&
        authenticated() === true &&
        fields() !== undefined,
      keepPreviousData: false,
      showSupportedForeignEntities: true,
      graphqlCacheFirstEntities: match(props.favorite.entityType)
        .returnType<SoupEntityRef[] | undefined>()
        .with('document', () => [
          { entityType: 'DOCUMENT', entityId: props.favorite.entityId },
        ])
        .with('project', () => [
          { entityType: 'PROJECT', entityId: props.favorite.entityId },
        ])
        .otherwise(() => undefined),
    })
  );
  createEffectOnEntityTypeNotification(
    source,
    props.favorite.entityType,
    (notification) => {
      if (
        entityQuery.isEnabled &&
        notification.entity_id === props.favorite.entityId
      ) {
        fireAndForget(entityQuery.refresh(), 'favorite-notifications');
      }
    }
  );
  const unread = () => {
    if (graphqlSoup().loading || authenticated() !== true) return false;
    if (!graphqlSoup().enabled) {
      return entityHasUnreadNotifications(source, {
        id: props.favorite.entityId,
        type: props.favorite.entityType,
      });
    }
    if (!fields() || !queryReadyGate(entityQuery)) return false;
    const entity = entityQuery.data.entities.find(
      (entity) => entity.id === props.favorite.entityId
    );
    return entity
      ? getEntityNotifications(entity, source).some(
          (notification) => !notificationIsRead(notification)
        )
      : false;
  };

  return (
    <Show when={unread()}>
      <UnreadIndicator active class="ml-auto" />
    </Show>
  );
}
