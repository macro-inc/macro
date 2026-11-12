import { fireAndForget } from '@core/util/fireAndForget';
import {
  registerActivityRevalidator,
  revalidateActivityQueries,
} from '@queries/activity/push-registry';
import { queryClient } from '@queries/client';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import { createTrailingRefetch } from '@queries/trailing-refetch';
import { createHiddenDeferral } from '@queries/visible-refresh';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { makeEventListener } from '@solid-primitives/event-listener';
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

/** The longest a visible project goes without an authorized read. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Fields update locally and activity pushes refetch, but a permission or
 * membership change can reach the viewer through neither, only through an
 * authorized read. So a visible project polls: 30 s after its last read and
 * when its window gains focus. A hidden tab sends no polls; if one fell due, it
 * reads once on becoming visible.
 */
export function registerProjectRevalidation(
  client: () => Client,
  enabled: () => boolean,
  refetch: () => Promise<unknown>
) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      schedule();
      due.request();
    }, POLL_INTERVAL_MS);
  };
  const refresh = createTrailingRefetch(
    () => !disposed && enabled(),
    () => {
      schedule();
      return refetch();
    }
  );
  // A poll joins a read in flight, so becoming visible and the focus that
  // follows it send one read between them.
  const due = createHiddenDeferral(() =>
    fireAndForget(poll(refresh.join), 'project-revalidation')
  );
  schedule();
  onCleanup(makeEventListener(window, 'focus', due.request));
  onCleanup(registerActivityRevalidator({ client, refresh }));
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
    due.dispose();
  });
}

async function poll(read: () => Promise<void>) {
  try {
    await read();
  } catch (error) {
    console.warn('Project query revalidation failed', error);
  }
}
