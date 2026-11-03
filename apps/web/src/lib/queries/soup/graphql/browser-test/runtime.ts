import { QueryClient } from '@tanstack/solid-query';
import { createClient, fetchExchange } from '@urql/core';
import { createSignal } from 'solid-js';
import { normalizedCacheExchange } from '../../../../graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '../../../../graphql-cache/host/types';
import { createWorkerCacheHost } from '../../../../graphql-cache/host/worker-host';
import { VIEWER } from './fixtures';

// Only application composition is replaced: the query source, exchange,
// fragments, worker and persisted cache all run their production implementations.
export const queryClient = new QueryClient();
export const cacheErrors: string[] = [];
const PARAMETERS = new URLSearchParams(location.search);
const PHYSICAL_HOST = createWorkerCacheHost({
  scope: PARAMETERS.get('scope') ?? `mail-flicker-${crypto.randomUUID()}`,
  requestTimeoutMs: 30_000,
});
let localReadGate = Promise.withResolvers<void>();
export function holdLocalReads() {
  localReadGate.resolve();
  localReadGate = Promise.withResolvers<void>();
}
export function releaseLocalReads() {
  localReadGate.resolve();
}
export const [pendingWrites, setPendingWrites] = createSignal(0);
export const host: CacheHost = {
  ...PHYSICAL_HOST,
  async writeQuery(args) {
    setPendingWrites((count) => count + 1);
    try {
      return await PHYSICAL_HOST.writeQuery(args);
    } finally {
      setPendingWrites((count) => count - 1);
    }
  },
  async entityFilter(args) {
    // Delay only transport; never fabricate a local result or its authority.
    await localReadGate.promise;
    return PHYSICAL_HOST.entityFilter(args);
  },
};
export const [cacheRevision, setCacheRevision] = createSignal<string>();
host.onCacheChanged(setCacheRevision, { includeHydration: true });
const CLIENT = createClient({
  url: `${location.origin}/__mail-flicker/graphql`,
  exchanges: [
    normalizedCacheExchange(host, {
      extractIdentity: () => VIEWER,
      onCacheError: (error) => cacheErrors.push(String(error)),
    }),
    fetchExchange,
  ],
});

// Vite redirects only the source's app singleton import to these real instances.
export const getGraphqlSoupClient = () => CLIENT;
export const getGraphqlSoupCacheHost = () => host;
export const hasGraphqlCacheHost = () => true;
export const graphqlSoupProjectionSupported = () => true;
