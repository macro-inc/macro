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

type ProjectReader = {
  projectId: () => string;
  refresh: () => Promise<void>;
};
// Mounted project reads, so one project can be read again without the
// activity readers and lists the app's own writes refresh.
const projectReaders = new Set<ProjectReader>();

/** Reads every mounted copy of one project again, and only that project. */
export async function refreshProjectReads(projectId: string) {
  await Promise.all(
    [...projectReaders]
      .filter((reader) => reader.projectId() === projectId)
      .map(async (reader) => {
        try {
          await reader.refresh();
        } catch (error) {
          console.warn('Project read failed', error);
        }
      })
  );
}

/**
 * Reads a mounted project again whenever the activity registry revalidates:
 * an activity push, the Soup websocket connecting or reconnecting, or one of
 * the app's own project writes (`refreshProjectQueries`). Nothing reads it on
 * a timer or on focus, so a share, unshare or membership change reaches an
 * open project only with one of those or a reopen.
 */
export function registerProjectRevalidation(
  client: () => Client,
  projectId: () => string,
  enabled: () => boolean,
  refetch: () => Promise<unknown>
) {
  let disposed = false;
  const refresh = createTrailingRefetch(() => !disposed && enabled(), refetch);
  const reader: ProjectReader = { projectId, refresh };
  projectReaders.add(reader);
  onCleanup(registerActivityRevalidator({ client, refresh }));
  onCleanup(() => {
    disposed = true;
    projectReaders.delete(reader);
  });
}
