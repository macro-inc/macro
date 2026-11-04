import { isDisplayableSoupItem } from '@queries/soup/transform-utils';
import type { SoupItemPreviewFieldsFragment } from '@service-storage/graphql/generated/graphql';
import {
  type GraphqlSoupItem,
  mapGraphqlSoupItem,
} from '@service-storage/graphql-soup';

/**
 * The Soup item an attention feed entity maps to, or null when the app does
 * not list it. The feed's own notifications replace the entity's notification
 * edge, which would read every notification of a channel, including its
 * threads'.
 */
export function attentionFeedSoupItem(entity: SoupItemPreviewFieldsFragment) {
  const item = mapGraphqlSoupItem({
    ...entity,
    notifications: [],
  } as GraphqlSoupItem);
  return item && isDisplayableSoupItem(item) ? item : null;
}
