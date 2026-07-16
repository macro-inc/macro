/**
 * Normalized GraphQL cache — JS glue.
 * Design doc: apps/web/docs/graphql-normalized-cache-plan.md
 */

export {
  executeOptimisticMutation,
  type OptimisticLinkPatch,
  type OptimisticMutationContext,
  type OptimisticMutationOptions,
  prependGroupedSoupItemLink,
  type QueryRevalidation,
  removeGroupedSoupItemLink,
} from './exchange/optimistic';
export { createTauriCacheHost } from './host/tauri-host';
export type {
  CacheHost,
  CacheReadArgs,
  CacheWriteArgs,
} from './host/types';
export { createWorkerCacheHost } from './host/worker-host';
export type {
  CachePush,
  CacheRequest,
  CacheResponse,
  OptimisticWriteResult,
  ReadResult,
  WriteResult,
} from './protocol';
