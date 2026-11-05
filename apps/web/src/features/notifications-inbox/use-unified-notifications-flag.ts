import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableGraphqlSoup,
  enableUnifiedNotifications,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the unified Notifications view, its route, and its rail entry are
 * available. The view reads only the GraphQL work feed, so it also needs the
 * GraphQL Soup transport.
 */
export function useUnifiedNotificationsFlag(): Accessor<boolean> {
  const notifications = useFeatureFlag(enableUnifiedNotifications);
  const graphql = useFeatureFlag(enableGraphqlSoup);
  return () => notifications().enabled && graphql().enabled;
}
