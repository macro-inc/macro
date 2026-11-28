import {
  type NetworkRevalidation,
  registerNetworkRevalidation,
} from '@graphql-cache/exchange/network-revalidation-exchange';
import type { Client } from '@urql/core';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import type { UrqlInfiniteQueryRefetchOptions } from './types';

type PagedQuery = {
  refetch(options: UrqlInfiniteQueryRefetchOptions): Promise<unknown>;
};

type PagedNetworkRevalidationOptions = {
  /** The client the list reads through. */
  client: Accessor<Client>;
  /** Identifies the chain (its first-page input); a new value gets a new owner. */
  chain: Accessor<unknown>;
  /** Whether the list reads the network now (enabled and not paused). */
  reads: Accessor<boolean>;
  /** Runs as each read starts, for state that read replaces. */
  before?: () => void;
};

/**
 * The owner that reads a paged query's loaded pages again in cursor order
 * after a committed write without the cache (`networkRevalidationExchange`).
 * Put it in every page's context. An owner is gone once its chain is no longer
 * the list's current one, so a page key the list has left and another reader
 * still holds is re-sent for that reader. The owner is also registered with
 * the client, which reaches it when urql joined the list's operations onto
 * another list's.
 */
export function createPagedNetworkRevalidation(
  query: () => PagedQuery,
  options: PagedNetworkRevalidationOptions
): Accessor<NetworkRevalidation> {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  // Only a changed value starts a new chain, not a recomputed equal one.
  const chain = createMemo(options.chain);
  const owner: Accessor<NetworkRevalidation> = createMemo(() => {
    chain();
    const self: NetworkRevalidation = {
      gone: () => disposed || owner() !== self,
      active: () => !self.gone() && options.reads(),
      revalidate: async () => {
        if (!self.active()) return;
        options.before?.();
        // A refetch already running may have read before the write committed.
        await query().refetch({ requestPolicy: 'network-only', fresh: true });
      },
    };
    onCleanup(registerNetworkRevalidation(options.client(), self));
    return self;
  });
  return owner;
}
