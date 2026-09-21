import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableRecentView } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the Recent view (the touched-by-me feed) and its sidebar entry are
 * shown. When off, the route redirects to the inbox and the touched query is
 * never issued.
 */
export function useRecentViewFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableRecentView);
  return () => flag().enabled;
}
