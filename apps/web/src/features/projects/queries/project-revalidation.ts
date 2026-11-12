import {
  registerActivityRevalidator,
  revalidateActivityQueries,
} from '@queries/activity/push-registry';
import { queryClient } from '@queries/client';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import { createTrailingRefetch } from '@queries/trailing-refetch';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type { QueryClient } from '@tanstack/solid-query';
import type { Client } from '@urql/core';
import { onCleanup } from 'solid-js';

/** Refresh live project details and collections after UI or agent-tool writes.
 * Without the normalized cache, shared lists that show projects as rows (Home,
 * Search) are plain Soup queries, so they are read again too. */
export async function refreshProjectQueries(
  client = getGraphqlSoupClient(),
  cache: QueryClient = queryClient,
  cacheHost = getGraphqlSoupCacheHost
) {
  const host = cacheHost();
  await Promise.all([
    refreshActiveGraphqlSoupQueries(),
    revalidateActivityQueries(client, null),
    !host || host.disabled
      ? cache.invalidateQueries({ queryKey: soupKeys._def })
      : undefined,
  ]);
}

/** Fields update locally; permissions and membership still need authorized reads. */
export function registerProjectRevalidation(
  client: () => Client,
  enabled: () => boolean,
  refetch: () => Promise<unknown>
) {
  let disposed = false;
  const refresh = createTrailingRefetch(() => !disposed && enabled(), refetch);
  const backgroundRefresh = () => {
    void refresh().catch((error) => {
      console.warn('Project query revalidation failed', error);
    });
  };
  const timer = setInterval(backgroundRefresh, 30_000);
  window.addEventListener('focus', backgroundRefresh);
  onCleanup(registerActivityRevalidator({ client, refresh }));
  onCleanup(() => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener('focus', backgroundRefresh);
  });
}
