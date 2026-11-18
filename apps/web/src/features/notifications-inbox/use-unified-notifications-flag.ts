import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableUnifiedNotifications } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the unified Notifications view, its route, and its rail entry are
 * available.
 */
export function useUnifiedNotificationsFlag(): Accessor<boolean> {
  const notifications = useFeatureFlag(enableUnifiedNotifications);
  return () => notifications().enabled;
}
