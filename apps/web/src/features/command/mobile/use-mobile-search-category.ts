import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableProjects } from '@core/constant/featureFlags';
import { SearchState } from './mobileSearchState';

export function useMobileSearchCategory() {
  const projects = useFeatureFlag(enableProjects);
  return () =>
    SearchState.category() === 'projects' && !projects().enabled
      ? 'all'
      : SearchState.category();
}
