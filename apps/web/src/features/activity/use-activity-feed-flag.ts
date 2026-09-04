import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableActivityFeed } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the Activity view (the user's own activity feed) and its sidebar
 * entry are shown. When off, the `/activity` route redirects to the inbox
 * and the feed query is never issued.
 */
export function useActivityFeedFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableActivityFeed);
  return () => flag().enabled;
}
