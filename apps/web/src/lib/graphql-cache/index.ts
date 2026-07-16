/**
 * Normalized GraphQL cache — JS glue.
 * Design doc: apps/web/docs/graphql-normalized-cache-plan.md
 */

export {
  type CachedSelection,
  type InspectionSelection,
  inspect,
  selectAll,
} from './exchange/inspection';
export {
  executeOptimisticMutation,
  type LinkDiff,
  type ListSelection,
  type OptimisticMutationOptions,
  type OptimisticUpdate,
  prependUnique,
  type QueryRevalidation,
  remove,
  type Selection,
  select,
  update,
} from './exchange/optimistic';
export { createTauriCacheHost } from './host/tauri-host';
export type {
  CacheHost,
  CacheReadArgs,
  CacheWriteArgs,
  InspectQueryArgs,
} from './host/types';
export { createWorkerCacheHost } from './host/worker-host';
export type {
  CachedQueryInstanceWire,
  CachePush,
  CacheRequest,
  CacheResponse,
  OptimisticWriteResult,
  ReadResult,
  WriteResult,
} from './protocol';
