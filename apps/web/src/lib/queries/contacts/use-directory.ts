import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { type Accessor, createMemo } from 'solid-js';
import { createContactDirectoryWindow } from './directory-query';
import {
  type ContactFilterSourceFactory,
  createContactFilterSource,
  createContactIdFilterSource,
} from './filter-source';

/** Production account/cache composition, separate from the bounded window. */
export function useContactDirectoryScope() {
  const viewer = useUserId();
  const authenticated = useIsAuthenticated();
  const flag = useFeatureFlag(enableGraphqlSoup);
  return createMemo(() => {
    flag();
    return {
      userId: authenticated() === true ? viewer() : undefined,
      host: getGraphqlSoupCacheHost(),
    };
  });
}

export const useContactFilterSource: ContactFilterSourceFactory = (
  selected,
  enabled
) => createContactFilterSource(useContactDirectoryScope(), selected, enabled);

export function useContactIdFilterSource(
  selected: Accessor<readonly string[]>,
  enabled: Accessor<boolean>
) {
  return createContactIdFilterSource(
    useContactDirectoryScope(),
    selected,
    enabled
  );
}

export function useContactDirectoryWindow() {
  return createContactDirectoryWindow(useContactDirectoryScope());
}
