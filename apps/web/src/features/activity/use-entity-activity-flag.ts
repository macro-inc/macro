import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableEntityActivitySection } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the entity side panel shows the Activity section. Gates the
 * section component itself, so the entity-activity GraphQL query is never
 * issued while off.
 */
export function useEntityActivityFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableEntityActivitySection);
  return () => flag().enabled;
}
