import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { createSharedRoot } from '@solid-primitives/rootless';
import { createRunningTimer } from './primitives/running-timer';

/**
 * The running timer every surface reads: one query, one clock and one
 * listener while any of them is mounted, kept across navigation. It runs
 * outside any component, where no flag can be read, so only surfaces behind
 * `enable-time-tracking` may use it.
 */
export const useRunningTimer = createSharedRoot(() =>
  createRunningTimer({ client: getGraphqlSoupClient, enabled: () => true })
);
