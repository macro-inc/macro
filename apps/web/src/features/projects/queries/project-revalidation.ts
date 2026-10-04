import { registerActivityRevalidator } from '@queries/activity/push-registry';
import { createTrailingRefetch } from '@queries/trailing-refetch';
import type { Client } from '@urql/core';
import { onCleanup } from 'solid-js';

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
