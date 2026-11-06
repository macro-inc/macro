import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';

/**
 * The Soup client, reread when its transport flag resolves. Only the realtime
 * client carries subscriptions, so a stream started on the plain client that
 * serves before then would never deliver.
 */
export function useWorkClient() {
  const transport = useFeatureFlag(enableGraphqlSoup);

  return () => {
    transport();
    return getGraphqlSoupClient();
  };
}
