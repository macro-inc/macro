import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCompanyBoard } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the Board view and its sidebar entry are shown. When off, the
 * `/board` route redirects Home and the board's feed is never queried.
 */
export function useBoardFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCompanyBoard);
  return () => flag().enabled;
}
