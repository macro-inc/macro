import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { createSharedRoot } from '@solid-primitives/rootless';
import { createRunningTimer } from './primitives/running-timer';

/**
 * The running timer every surface reads: one query, one clock and one
 * listener while any of them is mounted, kept across navigation.
 */
export const useRunningTimer = createSharedRoot(() => {
  const flag = useFeatureFlag(enableTimeTracking);
  return createRunningTimer({
    client: getGraphqlSoupClient,
    enabled: () => flag().enabled === true,
  });
});
