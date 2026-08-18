import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_ENTITY_ACTIVITY_SECTION_FLAG,
  ENABLE_ENTITY_ACTIVITY_SECTION_OVERRIDE,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the entity side panel shows the Activity section. Gates the
 * section component itself, so the entity-activity GraphQL query is never
 * issued while off.
 */
export function useEntityActivityFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(ENABLE_ENTITY_ACTIVITY_SECTION_FLAG, {
    enabledOverride: ENABLE_ENTITY_ACTIVITY_SECTION_OVERRIDE,
  });
  return () => flag().enabled;
}
