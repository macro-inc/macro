import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_FLOW_VIEW_FLAG,
  ENABLE_FLOW_VIEW_OVERRIDE,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the Flow view (inbox signal merged with the touched-by-me feed)
 * and its sidebar entry are shown. When off, the route redirects to the
 * inbox and neither of the view's queries is issued.
 */
export function useFlowViewFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(ENABLE_FLOW_VIEW_FLAG, {
    enabledOverride: ENABLE_FLOW_VIEW_OVERRIDE,
  });
  return () => flag().enabled;
}
