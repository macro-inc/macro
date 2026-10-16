import {
  registerActivityRevalidator,
  revalidateActivityQueries,
} from '@queries/activity/push-registry';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { createTrailingRefetch } from '@queries/trailing-refetch';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import { onCleanup } from 'solid-js';

/** Refresh live project details and collections after UI or agent-tool writes. */
export async function refreshProjectQueries(client = getGraphqlSoupClient()) {
  await Promise.all([
    refreshActiveGraphqlSoupQueries(),
    revalidateActivityQueries(client, null),
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
