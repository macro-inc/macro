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
 * Search is always a plain Soup query, and without the normalized cache so are
 * the other shared lists that show projects as rows (Home), so those are read
 * again too. */
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
      : cache.invalidateQueries({ queryKey: soupKeys.search._def }),
  ]);
}

/**
 * Reads a mounted project again when an activity push or a Soup websocket
 * reconnect revalidates it. Nothing reads it on a timer or on focus, so a
 * share, unshare or membership change reaches an open project only with a
 * later push or a reopen.
 */
export function registerProjectRevalidation(
  client: () => Client,
  enabled: () => boolean,
  refetch: () => Promise<unknown>
) {
  let disposed = false;
  const refresh = createTrailingRefetch(() => !disposed && enabled(), refetch);
  onCleanup(registerActivityRevalidator({ client, refresh }));
  onCleanup(() => {
    disposed = true;
  });
}
