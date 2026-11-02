import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { createMemo } from 'solid-js';
import { createContactDirectoryWindow } from './directory-query';

/** Production account/cache composition, separate from the bounded window. */
export function useContactDirectoryWindow() {
  const viewer = useUserId();
  const authenticated = useIsAuthenticated();
  const flag = useFeatureFlag(enableGraphqlSoup);
  const scope = createMemo(() => {
    flag();
    return {
      userId: authenticated() === true ? viewer() : undefined,
      host: getGraphqlSoupCacheHost(),
    };
  });
  return createContactDirectoryWindow(scope);
}
