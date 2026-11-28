import {
  type NetworkRevalidation,
  registerNetworkRevalidation,
} from '@graphql-cache/exchange/network-revalidation-exchange';
import type { TraceContext } from '@macro-inc/observability';
import type { Client } from '@urql/core';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import { TRACE_PARENT_CONTEXT_KEY } from './trace-parent-exchange';
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
      revalidate: async (trace) => {
        if (!self.active()) return;
        options.before?.();
        const reread = whileReading(trace);
        try {
          // A refetch already running may have read before the write
          // committed. A failed read rejects, so the write is not reported as
          // read again.
          await query().refetch({
            requestPolicy: 'network-only',
            fresh: true,
            throwOnError: true,
            context: { [TRACE_PARENT_CONTEXT_KEY]: reread.context },
          });
        } finally {
          reread.end();
        }
      },
    };
    onCleanup(registerNetworkRevalidation(options.client(), self));
    return self;
  });
  return owner;
}

/**
 * The trace each page a reread sends joins, though it sends after awaits that
 * lose the browser's context. A page keeps this context after the reread, so
 * a later send of it, outside the write, joins nothing.
 */
function whileReading(trace: TraceContext): {
  context: TraceContext;
  end(): void;
} {
  let reading = true;
  return {
    context: { run: (work) => (reading ? trace.run(work) : work()) },
    end: () => {
      reading = false;
    },
  };
}
