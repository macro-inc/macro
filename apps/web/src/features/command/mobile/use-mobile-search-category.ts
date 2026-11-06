import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableProjects } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';
import type { EntitySearchCategory } from '../queries/entity-search';
import { SearchState } from './mobileSearchState';

export function useMobileSearchCategory(
  category: Accessor<EntitySearchCategory> = SearchState.category
) {
  const projects = useFeatureFlag(enableProjects);
  return () =>
    category() === 'projects' && !projects().enabled ? 'all' : category();
}
